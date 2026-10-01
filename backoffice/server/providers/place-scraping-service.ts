import type {
  ApiErrorCode,
  GooglePlaceDetailsResponse,
} from '../../src/types/places.ts'
import type {
  DiscoveryCandidate,
  InstagramScrapeResult,
  PlaceScrapeRequest,
  PlaceScrapeResponse,
  ScrapeDiscoverySource,
  ScrapeSourceError,
  WebsiteScrapeResult,
} from './place-scraping-types.ts'
import type {
  ApifyGoogleSearchProvider,
  GoogleOrganicResult,
} from './apify-google-search-provider.ts'
import type { ApifyInstagramProvider, InstagramProfileData } from './apify-instagram-provider.ts'
import {
  assessInstagramCandidate,
  assessWebsiteCandidate,
  instagramFallbackSearchQuery,
  instagramSearchQuery,
  isForeignInstagramProfile,
  isUruguayInstagramProfile,
  normalizeWebsiteCandidateUrl,
  websiteSearchQuery,
} from './place-source-discovery.ts'
import { PlacesProviderError, type ProviderErrorKind } from './places-provider.ts'
import {
  normalizeInstagramProfileUrl,
  type PlaywrightWebsiteScraper,
  type WebsitePageData,
} from './website-scraper.ts'

const MAX_DISCOVERY_CANDIDATES = 3

type DetailsProvider = {
  getDetails(placeId: string): Promise<GooglePlaceDetailsResponse>
}

type WebsiteProvider = Pick<PlaywrightWebsiteScraper, 'configured' | 'scrape'> &
  Partial<Pick<PlaywrightWebsiteScraper, 'validateUrl'>>
type InstagramProvider = Pick<ApifyInstagramProvider, 'configured' | 'scrape'> &
  Partial<Pick<ApifyInstagramProvider, 'scrapeMany'>>
type GoogleSearchProvider = Pick<ApifyGoogleSearchProvider, 'configured' | 'search'>

type DiscoveryOutcome<T> = {
  accepted: T | null
  candidates: DiscoveryCandidate[]
  error?: ScrapeSourceError
}

type AcceptedWebsite = { data: WebsitePageData }
type AcceptedInstagram = { data: InstagramProfileData }

export type ScrapeDiscoveryHints = {
  websiteUrls: string[]
  instagramUrls: string[]
}

export interface PlaceScraper {
  readonly websiteConfigured: boolean
  readonly instagramConfigured: boolean
  readonly discoveryConfigured: boolean
  scrape(placeId: string, request?: PlaceScrapeRequest): Promise<PlaceScrapeResponse>
  enrichFromHints?: (placeId: string, hints: ScrapeDiscoveryHints) => Promise<PlaceScrapeResponse>
  scrapeDiscoveredUrls?: (urls: string[]) => Promise<WebsitePageData[]>
}

function apiCode(kind: ProviderErrorKind): ApiErrorCode {
  if (kind === 'configuration') return 'CONFIGURATION_ERROR'
  if (kind === 'validation') return 'VALIDATION_ERROR'
  if (kind === 'authorization') return 'AUTHORIZATION_ERROR'
  if (kind === 'quota') return 'QUOTA_ERROR'
  if (kind === 'timeout') return 'TIMEOUT_ERROR'
  return 'UPSTREAM_ERROR'
}

function sourceError(error: unknown): ScrapeSourceError {
  if (error instanceof PlacesProviderError) {
    return { code: apiCode(error.kind), message: error.message }
  }
  return {
    code: 'UNKNOWN_ERROR',
    message: 'No se pudo completar la extracción.',
  }
}

function websiteSection(data: WebsiteScrapeResult): string {
  return [
    'SITIO WEB',
    `URL: ${data.url}`,
    data.title ? `Título: ${data.title}` : '',
    data.description ? `Descripción: ${data.description}` : '',
    data.content ? `Contenido:\n${data.content}` : '',
  ].filter(Boolean).join('\n')
}

function instagramSection(data: InstagramScrapeResult): string {
  return [
    'INSTAGRAM',
    `URL: ${data.url}`,
    data.name ? `Nombre: ${data.name}` : '',
    data.bio ? `Bio: ${data.bio}` : '',
    data.links && data.links.length > 0 ? `Links:\n${data.links.join('\n')}` : '',
  ].filter(Boolean).join('\n')
}

function composeScrapedInfo(
  website: WebsiteScrapeResult,
  instagram: InstagramScrapeResult,
): string {
  return [
    website.status === 'success' ? websiteSection(website) : '',
    instagram.status === 'success' ? instagramSection(instagram) : '',
  ].filter(Boolean).join('\n\n')
}

function websiteSuccess(
  data: WebsitePageData,
  discoveredVia: ScrapeDiscoverySource,
): WebsiteScrapeResult {
  return {
    status: 'success',
    url: data.url,
    discoveredVia,
    title: data.title,
    description: data.description,
    content: data.content,
    instagramUrls: data.instagramUrls,
    links: data.links,
  }
}

function instagramSuccess(
  data: InstagramProfileData,
  discoveredVia: ScrapeDiscoverySource,
): InstagramScrapeResult {
  return {
    status: 'success',
    url: data.url,
    discoveredVia,
    name: data.name,
    bio: data.bio,
    links: data.links,
    posts: data.posts,
  }
}

function responseWith(
  website: WebsiteScrapeResult,
  instagram: InstagramScrapeResult,
  discovery: PlaceScrapeResponse['discovery'],
): PlaceScrapeResponse {
  return {
    source: 'scraping',
    scrapedInfo: composeScrapedInfo(website, instagram),
    website,
    instagram,
    discovery,
    attribution: discovery.googleSearchAttempted
      ? 'Sitio web del local · Instagram y Google Search vía Apify'
      : 'Sitio web del local · Instagram vía Apify',
  }
}

function uniqueWebsiteResults(results: GoogleOrganicResult[]): GoogleOrganicResult[] {
  const seen = new Set<string>()
  return results.flatMap((result) => {
    const url = normalizeWebsiteCandidateUrl(result.url)
    if (!url) return []
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    if (seen.has(hostname)) return []
    seen.add(hostname)
    return [{ ...result, url }]
  })
}

function uniqueInstagramResults(results: GoogleOrganicResult[]): GoogleOrganicResult[] {
  const seen = new Set<string>()
  return results.flatMap((result) => {
    const url = normalizeInstagramProfileUrl(result.url)
    if (!url || seen.has(url)) return []
    seen.add(url)
    return [{ ...result, url }]
  })
}

function firstEligibleWebsiteUrl(links: string[]): string | null {
  for (const link of links) {
    const url = normalizeWebsiteCandidateUrl(link)
    if (url) return url
  }
  return null
}

function linkAggregatorUrl(links: string[] | undefined): string | null {
  for (const link of links ?? []) {
    try {
      const host = new URL(link).hostname.toLowerCase().replace(/^www\./, '')
      if (['linktr.ee', 'beacons.ai', 'solo.to', 'campsite.bio'].some((domain) => host === domain || host.endsWith(`.${domain}`))) return link
    } catch {
      // Un link inválido no debe impedir descubrir el perfil directo.
    }
  }
  return null
}

export class PlaceScrapingService implements PlaceScraper {
  readonly websiteConfigured: boolean
  readonly instagramConfigured: boolean
  readonly discoveryConfigured: boolean
  private readonly details: DetailsProvider
  private readonly website: WebsiteProvider
  private readonly instagram: InstagramProvider
  private readonly googleSearch?: GoogleSearchProvider
  private readonly cache = new Map<string, Promise<PlaceScrapeResponse>>()

  constructor(config: {
    details: DetailsProvider
    website: WebsiteProvider
    instagram: InstagramProvider
    googleSearch?: GoogleSearchProvider
  }) {
    this.details = config.details
    this.website = config.website
    this.instagram = config.instagram
    this.googleSearch = config.googleSearch
    this.websiteConfigured = config.website.configured
    this.instagramConfigured = config.instagram.configured
    this.discoveryConfigured = Boolean(config.googleSearch?.configured)
  }

  async scrape(
    placeId: string,
    request: PlaceScrapeRequest = {},
  ): Promise<PlaceScrapeResponse> {
    if (request.refresh) this.cache.delete(placeId)
    if (request.selectedCandidate) {
      return this.selectCandidate(placeId, request.selectedCandidate)
    }

    const cached = this.cache.get(placeId)
    if (cached) return cached

    const pending = this.run(placeId).catch((error) => {
      this.cache.delete(placeId)
      throw error
    })
    this.store(placeId, pending)
    return pending
  }

  async enrichFromHints(placeId: string, hints: ScrapeDiscoveryHints): Promise<PlaceScrapeResponse> {
    const current = await this.scrape(placeId)
    const details = await this.details.getDetails(placeId)
    let website = current.website
    let instagram = current.instagram
    let websiteCandidates = current.discovery.websiteCandidates
    let instagramCandidates = current.discovery.instagramCandidates
    let instagramHintReview = current.discovery.instagramHintReview

    if (website.status !== 'success') {
      for (const value of [...new Set(hints.websiteUrls)]) {
        const url = normalizeWebsiteCandidateUrl(value)
        if (!url) continue
        try {
          const page = await this.website.scrape(url)
          const assessment = assessWebsiteCandidate(
            details.anchor,
            { title: '', url, description: '', position: 0 },
            page,
            instagram.status === 'success' ? instagram.url : null,
          )
          if (assessment?.autoAccept) {
            website = websiteSuccess(assessment.data, 'website_link')
            websiteCandidates = []
            break
          }
          if (assessment) websiteCandidates = [...websiteCandidates, assessment.candidate]
        } catch {
          // Una pista de Exa fallida no invalida las fuentes ya descubiertas.
        }
      }
    }

    if (instagram.status !== 'success') {
      const candidates = [...new Set(hints.instagramUrls
        .map((value) => normalizeInstagramProfileUrl(value))
        .filter((value): value is string => Boolean(value)))]
      if (candidates.length > 0) {
        try {
          const profiles = this.instagram.scrapeMany
            ? await this.instagram.scrapeMany(candidates)
            : (await Promise.all(candidates.map((url) => this.instagram.scrape(url))))
              .filter((profile): profile is InstagramProfileData => Boolean(profile))
          const assessments = profiles.flatMap((profile) => {
            if (isForeignInstagramProfile(profile)) {
              instagramHintReview = 'location_mismatch'
              return []
            }
            const assessment = assessInstagramCandidate(
              details.anchor,
              { title: profile.name, url: profile.url, description: profile.bio, position: 0 },
              profile,
              website.status === 'success' ? website.url : null,
            )
            return assessment?.autoAccept ? [assessment] : []
          })
          if (assessments.length === 1) {
            instagram = instagramSuccess(assessments[0].data, 'website_link')
            instagramCandidates = []
          } else if (assessments.length > 1) {
            instagramCandidates = [...instagramCandidates, ...assessments.map((assessment) => assessment.candidate)]
            instagramHintReview ??= 'unverified'
          } else if (!instagramHintReview) {
            instagramHintReview = 'unverified'
          }
        } catch {
          instagramHintReview ??= 'unverified'
        }
      }
    }

    const next = responseWith(website, instagram, {
      ...current.discovery,
      websiteCandidates,
      instagramCandidates,
      ...(instagramHintReview ? { instagramHintReview } : {}),
    })
    this.store(placeId, Promise.resolve(next))
    return next
  }

  async scrapeDiscoveredUrls(urls: string[]): Promise<WebsitePageData[]> {
    const unique = [...new Set(urls)].slice(0, 6)
    const pages = await Promise.all(unique.map(async (url) => {
      try {
        const parsed = new URL(url)
        if (!['http:', 'https:'].includes(parsed.protocol)) return null
        const safeUrl = this.website.validateUrl ? await this.website.validateUrl(url) : url
        return await this.website.scrape(safeUrl)
      } catch {
        return null
      }
    }))
    return pages.filter((page): page is WebsitePageData => Boolean(page))
  }

  private store(placeId: string, value: Promise<PlaceScrapeResponse>): void {
    this.cache.set(placeId, value)
    if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value as string)
  }

  private async run(placeId: string): Promise<PlaceScrapeResponse> {
    const details = await this.details.getDetails(placeId)
    const sourceUrl = details.websiteUri
    let website: WebsiteScrapeResult = { status: 'not_found', url: null }
    let instagram: InstagramScrapeResult = { status: 'not_found', url: null }
    let websiteData: WebsitePageData | null = null
    let instagramUrl = sourceUrl ? normalizeInstagramProfileUrl(sourceUrl) : null
    const sourceIsInstagram = Boolean(instagramUrl)
    let googleSearchAttempted = false
    let websiteCandidates: DiscoveryCandidate[] = []
    let instagramCandidates: DiscoveryCandidate[] = []

    if (sourceUrl && !instagramUrl) {
      try {
        websiteData = await this.website.scrape(sourceUrl)
        website = websiteSuccess(websiteData, 'google_places')
        instagramUrl = await this.instagramFromWebsite(websiteData)
      } catch (error) {
        website = { status: 'error', url: sourceUrl, error: sourceError(error) }
      }
    }

    if (instagramUrl) {
      const result = await this.scrapeInstagram(
        instagramUrl,
        sourceUrl && normalizeInstagramProfileUrl(sourceUrl)
          ? 'google_places'
          : 'website_link',
        details.anchor,
      )
      instagram = result.result

      if (sourceIsInstagram && result.data) {
        const websiteUrl = firstEligibleWebsiteUrl(result.data.links)
        if (websiteUrl) {
          try {
            websiteData = await this.website.scrape(websiteUrl)
            website = websiteSuccess(websiteData, 'website_link')
          } catch (error) {
            website = { status: 'error', url: websiteUrl, error: sourceError(error) }
          }
        }
      }
    }

    if (!sourceIsInstagram && website.status !== 'success' && this.googleSearch) {
      googleSearchAttempted = true
      const discovered = await this.discoverWebsite(
        details,
        instagram.status === 'success' ? instagram.url : instagramUrl,
      )
      websiteCandidates = discovered.candidates
      if (discovered.accepted) {
        websiteData = discovered.accepted.data
        website = websiteSuccess(websiteData, 'google_search')
        websiteCandidates = []
      } else if (discovered.error) {
        website = { status: 'error', url: website.url, error: discovered.error }
      } else if (website.status !== 'error') {
        website = { status: 'not_found', url: null }
      }
    }

    const websiteInstagramUrl = websiteData && instagram.status !== 'success'
      ? await this.instagramFromWebsite(websiteData)
      : null
    if (websiteInstagramUrl) {
      instagramUrl = websiteInstagramUrl
      const result = await this.scrapeInstagram(instagramUrl, 'website_link', details.anchor)
      instagram = result.result
    }

    if (!sourceIsInstagram && instagram.status !== 'success' && this.googleSearch) {
      googleSearchAttempted = true
      const discovered = await this.discoverInstagram(
        details,
        website.status === 'success' ? website.url : null,
      )
      instagramCandidates = discovered.candidates
      if (discovered.accepted) {
        instagram = instagramSuccess(discovered.accepted.data, 'google_search')
        instagramCandidates = []
      } else if (discovered.error) {
        instagram = { status: 'error', url: instagram.url, error: discovered.error }
      } else if (instagram.status !== 'error') {
        instagram = { status: 'not_found', url: null }
      }
    }

    return responseWith(website, instagram, {
      googleSearchAttempted,
      websiteCandidates,
      instagramCandidates,
    })
  }

  private async scrapeInstagram(
    url: string,
    discoveredVia: ScrapeDiscoverySource,
    anchor?: GooglePlaceDetailsResponse['anchor'],
  ): Promise<{ result: InstagramScrapeResult; data: InstagramProfileData | null }> {
    try {
      const data = await this.instagram.scrape(url)
      if (data && anchor && (isForeignInstagramProfile(data) || !isUruguayInstagramProfile(anchor, data))) {
        return { result: { status: 'not_found', url }, data: null }
      }
      return data
        ? { result: instagramSuccess(data, discoveredVia), data }
        : { result: { status: 'not_found', url }, data: null }
    } catch (error) {
      return {
        result: { status: 'error', url, error: sourceError(error) },
        data: null,
      }
    }
  }

  private async instagramFromWebsite(data: WebsitePageData): Promise<string | null> {
    if (data.instagramUrls[0]) return data.instagramUrls[0]
    const aggregator = linkAggregatorUrl(data.links)
    if (!aggregator) return null
    try {
      const landing = await this.website.scrape(aggregator)
      return landing.instagramUrls[0] ?? null
    } catch {
      return null
    }
  }

  private async discoverWebsite(
    details: GooglePlaceDetailsResponse,
    knownInstagramUrl: string | null,
  ): Promise<DiscoveryOutcome<AcceptedWebsite>> {
    if (!this.googleSearch) return { accepted: null, candidates: [] }

    let results: GoogleOrganicResult[]
    try {
      results = await this.googleSearch.search(websiteSearchQuery(details.anchor))
    } catch (error) {
      return { accepted: null, candidates: [], error: sourceError(error) }
    }

    const assessments = []
    let firstError: ScrapeSourceError | undefined
    for (const result of uniqueWebsiteResults(results).slice(0, MAX_DISCOVERY_CANDIDATES)) {
      try {
        const safeUrl = this.website.validateUrl
          ? await this.website.validateUrl(result.url)
          : result.url
        const page = await this.website.scrape(safeUrl)
        if (!normalizeWebsiteCandidateUrl(page.url)) continue
        const assessment = assessWebsiteCandidate(
          details.anchor,
          result,
          page,
          knownInstagramUrl,
        )
        if (assessment) assessments.push(assessment)
      } catch (error) {
        firstError ??= sourceError(error)
      }
    }

    const accepted = assessments.find((assessment) => assessment.autoAccept)
    if (accepted) return { accepted: { data: accepted.data }, candidates: [] }
    return {
      accepted: null,
      candidates: assessments.map((assessment) => assessment.candidate),
      ...(assessments.length === 0 && firstError ? { error: firstError } : {}),
    }
  }

  private async discoverInstagram(
    details: GooglePlaceDetailsResponse,
    knownWebsiteUrl: string | null,
  ): Promise<DiscoveryOutcome<AcceptedInstagram>> {
    if (!this.googleSearch) return { accepted: null, candidates: [] }

    const primary = await this.discoverInstagramWithQuery(
      details,
      knownWebsiteUrl,
      instagramSearchQuery(details.anchor),
    )
    if (primary.accepted || primary.error) {
      return primary
    }

    const fallback = await this.discoverInstagramWithQuery(
      details,
      knownWebsiteUrl,
      instagramFallbackSearchQuery(details.anchor),
    )
    if (fallback.accepted) return fallback
    if (fallback.error && primary.candidates.length === 0) return fallback

    const seen = new Set<string>()
    const candidates = [...primary.candidates, ...fallback.candidates]
      .filter((candidate) => {
        if (seen.has(candidate.url)) return false
        seen.add(candidate.url)
        return true
      })
      .slice(0, MAX_DISCOVERY_CANDIDATES)
    return { accepted: null, candidates }
  }

  private async discoverInstagramWithQuery(
    details: GooglePlaceDetailsResponse,
    knownWebsiteUrl: string | null,
    query: string,
  ): Promise<DiscoveryOutcome<AcceptedInstagram>> {
    if (!this.googleSearch) return { accepted: null, candidates: [] }

    let results: GoogleOrganicResult[]
    try {
      results = await this.googleSearch.search(query)
    } catch (error) {
      return { accepted: null, candidates: [], error: sourceError(error) }
    }

    const candidates = uniqueInstagramResults(results).slice(0, MAX_DISCOVERY_CANDIDATES)
    if (candidates.length === 0) return { accepted: null, candidates: [] }

    let profiles: InstagramProfileData[]
    try {
      profiles = this.instagram.scrapeMany
        ? await this.instagram.scrapeMany(candidates.map((candidate) => candidate.url))
        : (await Promise.all(
            candidates.map((candidate) => this.instagram.scrape(candidate.url)),
          )).filter((profile): profile is InstagramProfileData => Boolean(profile))
    } catch (error) {
      return { accepted: null, candidates: [], error: sourceError(error) }
    }

    const profilesByUrl = new Map(profiles.flatMap((profile) => {
      const url = normalizeInstagramProfileUrl(profile.url)
      return url ? [[url, { ...profile, url }] as const] : []
    }))
    const assessments = candidates.flatMap((result) => {
      const profile = profilesByUrl.get(result.url)
      if (!profile) return []
      const assessment = assessInstagramCandidate(
        details.anchor,
        result,
        profile,
        knownWebsiteUrl,
      )
      return assessment ? [assessment] : []
    })

    const accepted = assessments.find((assessment) => assessment.autoAccept)
    if (accepted) return { accepted: { data: accepted.data }, candidates: [] }
    return {
      accepted: null,
      candidates: assessments.map((assessment) => assessment.candidate),
    }
  }

  private async selectCandidate(
    placeId: string,
    selected: NonNullable<PlaceScrapeRequest['selectedCandidate']>,
  ): Promise<PlaceScrapeResponse> {
    const cached = this.cache.get(placeId)
    if (!cached) {
      throw new PlacesProviderError(
        'validation',
        'El candidato ya no está disponible. Volvé a ejecutar la búsqueda.',
      )
    }

    const current = await cached
    const candidates = selected.kind === 'website'
      ? current.discovery.websiteCandidates
      : current.discovery.instagramCandidates
    const candidate = candidates.find((item) => item.url === selected.url)
    if (!candidate) {
      throw new PlacesProviderError(
        'validation',
        'La fuente seleccionada no pertenece a los candidatos del lugar.',
      )
    }

    const pending = this.applyCandidate(current, candidate)
    this.store(placeId, pending)
    return pending
  }

  private async applyCandidate(
    current: PlaceScrapeResponse,
    candidate: DiscoveryCandidate,
  ): Promise<PlaceScrapeResponse> {
    let website = current.website
    let instagram = current.instagram
    let websiteCandidates = current.discovery.websiteCandidates
    let instagramCandidates = current.discovery.instagramCandidates

    if (candidate.kind === 'website') {
      try {
        const data = await this.website.scrape(candidate.url)
        website = websiteSuccess(data, 'user_selected')
        websiteCandidates = []
        const instagramUrl = await this.instagramFromWebsite(data)
        if (instagram.status !== 'success' && instagramUrl) {
          const result = await this.scrapeInstagram(instagramUrl, 'website_link')
          instagram = result.result
          if (instagram.status === 'success') instagramCandidates = []
        }
      } catch (error) {
        website = { status: 'error', url: candidate.url, error: sourceError(error) }
      }
    } else {
      const result = await this.scrapeInstagram(candidate.url, 'user_selected')
      instagram = result.result
      if (instagram.status === 'success') instagramCandidates = []
    }

    return responseWith(website, instagram, {
      ...current.discovery,
      websiteCandidates,
      instagramCandidates,
    })
  }
}
