import { isIP } from 'node:net'
import type { PlaceAnchor } from '../../src/types/places.ts'
import type { DiscoveryCandidate } from './place-scraping-types.ts'
import type { GoogleOrganicResult } from './apify-google-search-provider.ts'
import type { InstagramProfileData } from './apify-instagram-provider.ts'
import { canonicalizeName } from './place-match-provider.ts'
import { isBlockedIp, type WebsitePageData } from './website-scraper.ts'

const EXCLUDED_WEBSITE_HOSTS = [
  'facebook.com',
  'fb.com',
  'instagram.com',
  'instagr.am',
  'tiktok.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'linkedin.com',
  'google.com',
  'google.com.uy',
  'goo.gl',
  'tripadvisor.com',
  'tripadvisor.es',
  'corner.inc',
  'wanderlog.com',
  'laguiadelociouruguay.com',
  'saliracomer.com',
  'mapquest.com',
  'yelp.com',
  'foursquare.com',
  'restaurantguru.com',
  'sluurpy.com',
  'pedidosya.com',
  'rappi.com',
  'ubereats.com',
  'opentable.com',
  'waze.com',
  'linktr.ee',
  'beacons.ai',
]

const ADDRESS_STOP_WORDS = new Set([
  'calle',
  'avenida',
  'av',
  'de',
  'del',
  'la',
  'las',
  'los',
  'y',
  'montevideo',
  'departamento',
  'uruguay',
  'codigo',
  'postal',
])

type CandidateAssessment<T> = {
  candidate: DiscoveryCandidate
  data: T
  autoAccept: boolean
}

function queryTerms(value: string, maxWords: number): string {
  return value
    .replace(/["\r\n]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(' ')
}

function streetAddress(address: string): string {
  return queryTerms(address.split(',')[0] ?? address, 8)
}

export function websiteSearchQuery(anchor: PlaceAnchor): string {
  return [
    queryTerms(anchor.name, 10),
    streetAddress(anchor.address),
    'Montevideo Uruguay',
    '-site:instagram.com',
    '-site:facebook.com',
  ].join(' ')
}

export function instagramSearchQuery(anchor: PlaceAnchor): string {
  return queryTerms(anchor.name, 12)
}

export function instagramFallbackSearchQuery(anchor: PlaceAnchor): string {
  return `${queryTerms(anchor.name, 12)} Montevideo Uruguay`
}

function normalizedHostname(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

function sameHostname(left: string, right: string): boolean {
  const leftHost = normalizedHostname(left)
  const rightHost = normalizedHostname(right)
  return Boolean(leftHost && rightHost && leftHost === rightHost)
}

function isHomepageLike(value: string): boolean {
  try {
    const pathname = new URL(value).pathname.replace(/\/+$/, '')
    return pathname === '' || /^\/(?:home|inicio|index(?:\.html?)?)$/i.test(pathname)
  } catch {
    return false
  }
}

export function normalizeWebsiteCandidateUrl(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null

  const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    isIP(hostname) > 0 && isBlockedIp(hostname)
  ) return null
  if (
    hostname.split('.').includes('tripadvisor') ||
    EXCLUDED_WEBSITE_HOSTS.some((blocked) =>
      hostname === blocked || hostname.endsWith(`.${blocked}`),
    )
  ) return null

  url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|gclid|fbclid)/i.test(key)) url.searchParams.delete(key)
  }
  return url.href
}

function nameEvidence(anchorName: string, values: string[]): boolean {
  const anchor = canonicalizeName(anchorName)
  if (!anchor) return false
  return values.some((value) => {
    const candidate = canonicalizeName(value)
    return candidate.includes(anchor) || anchor.includes(candidate) && candidate.length >= 5
  })
}

function locationEvidence(address: string, values: string[]): boolean {
  const haystack = canonicalizeName(values.join(' '))
  if (!haystack) return false
  const addressCanonical = canonicalizeName(address)
  const addressTokens = addressCanonical.split(' ').filter(Boolean)
  const numbers = addressTokens.filter((token) => /^\d{2,}$/.test(token))
  if (numbers.some((number) => haystack.split(' ').includes(number))) return true

  const streetTokens = [...new Set(addressTokens.filter((token) =>
    token.length >= 4 && !ADDRESS_STOP_WORDS.has(token) && !/^\d+$/.test(token),
  ))]
  if (streetTokens.filter((token) => haystack.includes(token)).length >= 2) return true
  return addressCanonical.includes('montevideo') && haystack.includes('montevideo')
}

export function isUruguayInstagramProfile(anchor: PlaceAnchor, profile: InstagramProfileData): boolean {
  const values = [profile.name, profile.bio, ...profile.links, ...(profile.posts ?? [])]
  const normalized = values.join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const hasLocalSignal = /\bmontevideo\b|\buruguay\b|\buru\b|\b(?:uy|mvd)\b/.test(normalized)
  // La ciudad/país declarado en la bio ya es una señal geográfica suficiente;
  // si además aparece la dirección, locationEvidence agrega una comprobación más fuerte.
  return hasLocalSignal && (locationEvidence(anchor.address, values) || /\bmontevideo\b|\buruguay\b/.test(normalized))
}

export function isForeignInstagramProfile(profile: InstagramProfileData): boolean {
  const normalized = [profile.name, profile.bio, ...profile.links, ...(profile.posts ?? [])]
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  return /\bbrasil\b|\bbrazil\b|\bargentina\b|\bbuenos aires\b|\.br\b|\.ar\b/.test(normalized)
}

export function assessWebsiteCandidate(
  anchor: PlaceAnchor,
  result: GoogleOrganicResult,
  page: WebsitePageData,
  knownInstagramUrl: string | null,
): CandidateAssessment<WebsitePageData> | null {
  const values = [
    result.title,
    result.description,
    page.title,
    page.description,
    page.content,
  ]
  const hasTitleName = nameEvidence(anchor.name, [result.title, page.title])
  const hasName = nameEvidence(anchor.name, values)
  const hasLocation = locationEvidence(anchor.address, values)
  const hasHomepage = isHomepageLike(page.url)
  const hasInstagramCrossLink = Boolean(
    knownInstagramUrl && page.instagramUrls.includes(knownInstagramUrl),
  )
  if (!hasName && !hasInstagramCrossLink) return null

  const evidence = [
    hasTitleName
      ? 'El título coincide con Google Places.'
      : hasName ? 'El contenido menciona el nombre del local.' : '',
    hasLocation ? 'La dirección o localidad coincide.' : '',
    hasHomepage ? 'Es la página principal del dominio.' : '',
    hasInstagramCrossLink ? 'La web enlaza al Instagram confirmado.' : '',
  ].filter(Boolean)

  return {
    data: page,
    autoAccept:
      hasInstagramCrossLink || hasTitleName && hasLocation && hasHomepage,
    candidate: {
      kind: 'website',
      url: page.url,
      title: page.title || result.title || page.url,
      snippet: page.description || result.description || null,
      confidence: hasName || hasInstagramCrossLink ? 'medium' : 'low',
      evidence,
    },
  }
}

export function assessInstagramCandidate(
  anchor: PlaceAnchor,
  result: GoogleOrganicResult,
  profile: InstagramProfileData,
  knownWebsiteUrl: string | null,
): CandidateAssessment<InstagramProfileData> | null {
  const hasProfileName = nameEvidence(anchor.name, [profile.name])
  const hasSearchName = nameEvidence(anchor.name, [result.title, result.description])
  const hasName = hasProfileName || hasSearchName
  const hasLocation = locationEvidence(anchor.address, [
    result.title,
    result.description,
    profile.name,
    profile.bio,
  ])
  const hasWebsiteCrossLink = Boolean(
    knownWebsiteUrl && profile.links.some((link) => sameHostname(link, knownWebsiteUrl)),
  )
  const isUruguayProfile = isUruguayInstagramProfile(anchor, profile)
  if (!hasName && !hasWebsiteCrossLink) return null

  const evidence = [
    hasProfileName
      ? 'El nombre del perfil coincide.'
      : hasSearchName ? 'El resultado de Google menciona el nombre.' : '',
    hasLocation ? 'La bio menciona la dirección o localidad.' : '',
    hasWebsiteCrossLink ? 'El perfil enlaza al sitio web confirmado.' : '',
  ].filter(Boolean)

  return {
    data: profile,
    // Un perfil homónimo sólo se acepta sin enlace cruzado si tiene una señal local verificable.
    autoAccept: hasWebsiteCrossLink || hasProfileName && hasLocation && isUruguayProfile,
    candidate: {
      kind: 'instagram',
      url: profile.url,
      title: profile.name || result.title || profile.url,
      snippet: profile.bio || result.description || null,
      confidence: hasProfileName || hasWebsiteCrossLink ? 'medium' : 'low',
      evidence,
    },
  }
}
