import { APICallError, generateText, Output } from 'ai'
import { z } from 'zod'
import {
  CATEGORIES,
  type CategoryId,
  CUISINES,
  DRINKS,
  FEATURES,
  FOODS,
  GOOD_FOR,
  MOMENTS,
  buildEmbeddingText,
  buildKeywordText,
  ids,
} from '../../src/data/tags.ts'
import { PlaceDraft } from '../../src/data/place-schema.ts'
import { getNeighborhood } from '../../src/lib/getNeighborhood.ts'
import { neighborhoodDisplayName } from '../../src/data/neighborhood-names.ts'
import type {
  ExaPlaceResponse,
  GooglePlaceDetailsResponse,
  InstagramAuditCandidate,
  PlaceEnrichmentDraft,
  PlaceEnrichmentResponse,
  PlaceExtractionCost,
  PlaceExtractionPerformance,
} from '../../src/types/places.ts'
import { PlacesProviderError } from './places-provider.ts'
import type { TransitInfo } from './montevideo-bus-provider.ts'
import type { ExaPlaceProvider } from './exa-place-provider.ts'
import type { ApifyInstagramProvider, InstagramProfileData } from './apify-instagram-provider.ts'
import type { PlaywrightWebsiteScraper, WebsitePageData } from './website-scraper.ts'

const MODEL = 'gpt-5-mini' as const
const MAX_CHARS_PER_SOURCE = 6_000
const BLOCKED_HOSTS = ['google.com', 'goo.gl', 'maps.app.goo.gl', 'corner.inc', 'exa.ai', 'facebook.com', 'foursquare.com']
const DIRECTORY_HOSTS = ['opina.com.uy', 'linkedin.com', 'tripadvisor', 'restaurantguru', 'yelp.com', 'wanderlog.com', 'saliracomer.com', 'laguiadelociouruguay.com']
const APPROXIMATE_HOURS = /\b(typically|generally|usually|approximately|aproximadamente|suele|en general)\b/i

export type SourceKind = 'web' | 'instagram' | 'reservations' | 'directory' | 'exa'
export type SourceTrust = 'official' | 'third_party'
type HoursSlot = { day: number; opens: string; closes: string | null }
type HoursRange = { days: string; opens: string; closes: string | null }
export type Source = {
  id: string
  kind: SourceKind
  trust: SourceTrust
  url: string
  text: string
  links?: string[]
  hoursRaw?: string
  hoursSlots?: HoursRange[]
  menu?: string[]
  exaDescription?: string
  exaKnowsBeforeYouGo?: string
}
type SourceCandidate = Omit<Source, 'kind' | 'trust'> & { kind: SourceKind | 'blocked'; trust?: SourceTrust }
type SourceContext = { name: string; websiteUrl?: string | null; instagramUrls?: string[] }
type Target = Omit<PlaceEnrichmentDraft, 'categories' | 'moments' | 'cuisines' | 'foods' | 'drinks' | 'features' | 'goodFor' | 'dietary' | 'price' | 'reservations' | 'outdoorSeating' | 'hours' | 'contact' | 'highlights' | 'description' | 'embeddingText' | 'keywordText'>

const DietLevel = z.enum(['unknown', 'no', 'has_options', 'fully'])
const TriState = z.enum(['unknown', 'yes', 'no'])

export const PlaceExtraction = z.object({
  categories: z.array(z.enum(ids(CATEGORIES))),
  moments: z.array(z.enum(ids(MOMENTS))),
  cuisines: z.array(z.enum(ids(CUISINES))).max(3),
  foods: z.array(z.enum(ids(FOODS))),
  drinks: z.array(z.enum(ids(DRINKS))),
  features: z.array(z.enum(ids(FEATURES))),
  goodFor: z.array(z.enum(ids(GOOD_FOR))),
  dietary: z.object({ vegan: DietLevel, vegetarian: DietLevel, glutenFree: DietLevel }),
  price: z.enum(['unknown', 'low', 'moderate', 'high', 'very_high']),
  reservations: z.enum(['unknown', 'no_reservations', 'accepts', 'recommended']),
  outdoorSeating: TriState,
  hours: z.object({
    raw: z.string().nullable(),
    display: z.object({ es: z.string(), en: z.string() }).nullable(),
    ranges: z.array(z.object({
      days: z.string(),
      opens: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      closes: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
    })),
  }),
  contact: z.object({
    phone: z.string().nullable(),
    whatsapp: z.string().nullable(),
    instagram: z.string().nullable(),
    website: z.string().nullable(),
    menuUrl: z.string().nullable(),
    reservationUrl: z.string().nullable(),
  }),
  highlights: z.array(z.object({ es: z.string(), en: z.string() })).max(8),
  description: z.object({ es: z.string(), en: z.string() }),
  evidence: z.array(z.object({ field: z.string(), sourceId: z.string(), quote: z.string().max(500).nullable() })),
})

export type PlaceExtraction = z.infer<typeof PlaceExtraction>

export type PlaceExtractor = {
  readonly configured: boolean
  extract(placeId: string, request: { name: string; seedCategory: CategoryId; refresh?: boolean }): Promise<PlaceEnrichmentResponse>
}

type DetailsProvider = { getDetails(placeId: string): Promise<GooglePlaceDetailsResponse> }
type InstagramProvider = Pick<ApifyInstagramProvider, 'configured' | 'scrapeMany'>
type WebsiteProvider = Pick<PlaywrightWebsiteScraper, 'configured' | 'scrape'>
type TransitProvider = { findNearbyLines(latitude: number, longitude: number): Promise<TransitInfo> }
type GeneratedExtraction = { data: PlaceExtraction; inputTokens: number | null; outputTokens: number | null }
type GenerateExtraction = (target: Target, sources: Source[]) => Promise<PlaceExtraction | GeneratedExtraction>

type ExtractionCostRates = {
  googleDetailsRequestUsd: number
  exaSearchRequestUsd: number
  exaContentPageUsd: number
  instagramRunUsd: number
  scrapingRequestUsd: number
  transitRequestUsd: number
  llmInputTokenUsd: number
  llmOutputTokenUsd: number
}

type ExtractionCostUsage = {
  googleRequests: number
  exaRequests: number
  exaContentPages: number
  instagramRequests: number
  scrapingRequests: number
  transitRequests: number
}

const DEFAULT_COST_RATES: ExtractionCostRates = {
  // Precios de lista por evento: Google Place Details Enterprise + Atmosphere,
  // Exa Search con contenido + highlights, y GPT-5 mini por token.
  googleDetailsRequestUsd: 0.025,
  exaSearchRequestUsd: 0.007,
  exaContentPageUsd: 0.002,
  instagramRunUsd: 0,
  scrapingRequestUsd: 0,
  transitRequestUsd: 0,
  llmInputTokenUsd: 0.25 / 1_000_000,
  llmOutputTokenUsd: 2 / 1_000_000,
}

function configuredCostRate(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function extractionCostRates(overrides: Partial<ExtractionCostRates> = {}): ExtractionCostRates {
  return {
    googleDetailsRequestUsd: configuredCostRate('EXTRACTION_COST_GOOGLE_DETAILS_USD', overrides.googleDetailsRequestUsd ?? DEFAULT_COST_RATES.googleDetailsRequestUsd),
    exaSearchRequestUsd: configuredCostRate('EXTRACTION_COST_EXA_SEARCH_USD', overrides.exaSearchRequestUsd ?? DEFAULT_COST_RATES.exaSearchRequestUsd),
    exaContentPageUsd: configuredCostRate('EXTRACTION_COST_EXA_CONTENT_PAGE_USD', overrides.exaContentPageUsd ?? DEFAULT_COST_RATES.exaContentPageUsd),
    instagramRunUsd: configuredCostRate('EXTRACTION_COST_INSTAGRAM_RUN_USD', overrides.instagramRunUsd ?? DEFAULT_COST_RATES.instagramRunUsd),
    scrapingRequestUsd: configuredCostRate('EXTRACTION_COST_SCRAPING_REQUEST_USD', overrides.scrapingRequestUsd ?? DEFAULT_COST_RATES.scrapingRequestUsd),
    transitRequestUsd: configuredCostRate('EXTRACTION_COST_TRANSIT_REQUEST_USD', overrides.transitRequestUsd ?? DEFAULT_COST_RATES.transitRequestUsd),
    llmInputTokenUsd: configuredCostRate('EXTRACTION_COST_LLM_INPUT_TOKEN_USD', overrides.llmInputTokenUsd ?? DEFAULT_COST_RATES.llmInputTokenUsd),
    llmOutputTokenUsd: configuredCostRate('EXTRACTION_COST_LLM_OUTPUT_TOKEN_USD', overrides.llmOutputTokenUsd ?? DEFAULT_COST_RATES.llmOutputTokenUsd),
  }
}

export const SYSTEM_PROMPT = `Sos un curador de gastronomía de Montevideo. Devolvé un JSON estructurado y verificable sobre el local objetivo a partir de sus fuentes.

REGLAS
- Cada fuente indica si es OFICIAL (web o Instagram validado del local) o TERCEROS (Exa, directorios y reservas). Ante contradicciones para un mismo dato, gana la fuente OFICIAL.
- foods y cuisines: incluílos SOLO si una fuente menciona un plato, ingrediente o tipo de cocina concreto. No deduzcas platos típicos por el tipo de local. Para cuisines, usá uruguayan como máximo si el contexto lo sostiene. Nunca agregues tags de comida sin mención explícita.
- goodFor: la inferencia requiere señales claras. work sólo si se menciona wifi, enchufes, "para trabajar" o si es un café con mesas y horario diurno. Para los demás, usá señales explícitas de ambiente o propuesta.
- features: se pueden inferir desde descripciones concretas, por ejemplo "patio compartido" => patio. features de espacio al aire libre: si cualquier fuente menciona patio, patio compartido, jardín, terraza, rooftop, vereda o mesas afuera (en español o inglés: patio, shared patio, garden, terrace, outdoor seating), agregá el feature correspondiente (patio, terrace o sidewalk) y poné outdoorSeating en "yes".
- Inferencias guía: inferí un tag únicamente cuando una mención concreta de la fuente lo respalde. No uses ejemplos de platos, bebidas ni locales como datos de referencia.
- Café de especialidad más wifi o trabajo => goodFor.work. Wine bar o coctelería cálida/íntima => first_date y after_office. Mesas grandes, picadas o para compartir => groups. Si es sólo café o bar sin cocina definida, cuisines queda vacío.
- dietary NO se infiere: has_options o fully sólo si una fuente menciona explícitamente opciones veganas, vegetarianas o sin TACC/sin gluten. Si no, unknown. "no" solamente si la fuente lo dice explícitamente.
- Ignorá otras ciudades, países y sucursales para horarios, teléfonos y features.
- Ignorá contenido de tienda online: productos envasados, bolsas de café, suscripciones, insumos, merch, gift cards y sus precios. Solo te interesa lo que se consume en el local. Ni highlights ni la descripción pueden mencionar productos de la tienda online. Ignorá también reseñas y puntajes.
- Usá solamente los tags permitidos. cuisines tiene máximo tres valores.
- MOMENTS: brunch sólo si aparece literalmente “brunch”. afternoon_snack sólo si se menciona merienda o el lugar es café/panadería. Nunca devuelvas late_night: el código lo decide exclusivamente desde horarios.
- FEATURES: open_kitchen sólo si se ve o menciona una cocina a la vista/abierta; bar_seating sólo si se puede comer en la barra, no por tener un bar para pedir bebidas.
- dietary: has_options si hay opciones; fully solo si todo el local cumple. price solo con precios o evidencia explícita.
- hours.raw conserva el texto de horarios exactamente como aparece en la fuente, sin reinterpretarlo; usá null si no hay texto. hours.display es una versión natural y concisa del mismo raw en español e inglés; usá null si raw es null. hours.ranges usa objetos { days, opens, closes }: days conserva el rango publicado (por ejemplo "Tue-Sun"), opens/closes usan HH:MM y closes puede ser null si falta el cierre. Nunca devuelvas horarios día por día: el código expande cada rango. Convertí formatos de 12/24 horas, español/inglés y rangos como todos los días, de martes a domingo o lun a vie. Dos turnos requieren dos rangos; trasnoche cierra con la hora del día siguiente. Los horarios pueden venir en muchos formatos. Reconocé y convertí todos, por ejemplo:
  - "Every day, 12:00 PM - 01:00 AM" → los 7 días, opens 12:00, closes 01:00
  - "Mon-Fri 9:00-18:00" → lunes a viernes, opens 09:00, closes 18:00
  - "Lunes a viernes de 9 a 18" → lunes a viernes, opens 09:00, closes 18:00
  - "Mar a Dom 19 a 02 hs" → martes a domingo, opens 19:00, closes 02:00
  - Tablas día por día (ej. "Lunes | 2–8 p.m.", "Martes | 8 a.m.–8 p.m.") → una entrada por día con su horario
  - "Cerrado" o "Closed" en un día → ese día no lleva entrada
  Los horarios del resumen de Exa (campo open_hours) son válidos: usalos si no hay horarios en la web o el Instagram del local. Si la fuente usa “typically”, “generally”, “usually”, “approximately”, “aproximadamente”, “suele” o “en general”, no cargues horarios.
- description.es: 2-3 frases rioplatenses, cercanas y sin exagerar. description.en: la misma idea en inglés natural. No copies las fuentes.
- highlights son platos o tragos concretos y cortos mencionados en menú, web o Instagram; nunca productos de tienda online. Devolvé cada uno como { es, en }. highlights.es siempre en español, aunque la fuente esté en otro idioma: usá el nombre conocido en español cuando exista (por ejemplo, “Galician pie” → “Pastel gallego”, “Feira octopus” → “Pulpo a la feira”, “Padrón peppers” → “Pimientos de Padrón”). highlights.en siempre en inglés. Priorizá los que ayudan a decidir. Para nombres locales sin traducción real, conservá el mismo nombre en en; si hace falta, sumá sólo en en una aclaración breve entre paréntesis.
- website es exclusivamente la web propia del local. Links de reservas, delivery, WhatsApp o Linktree van al campo de contacto que corresponda, nunca a website.
- evidence debe incluir una entrada por cada tag, momento, highlight, horario y dato de contacto informado, usando field con el path del dato (por ejemplo moments.brunch, contact.website, hours.raw u hours.slots.0) y el id de la fuente que lo respalda. Para una inferencia, citá el fragmento contextual que la hace razonable. quote debe ser un fragmento textual literal de la fuente, en su idioma original, de hasta 15 palabras; nunca traduzcas ni parafrasees.
- Las etiquetas sueltas de un directorio, como “Tags: Brunch” o “Categories: X”, no son evidencia válida de moments, goodFor ni features.
- Si las fuentes no parecen ser del local, no uses su información. La descripción debe ser de 2-3 frases: qué es, qué se come y toma, ambiente y mejor momento; no menciones horarios ni empresas o terceros irrelevantes.`

export const DEFAULT_RESERVATION_HOSTS = ['meitre.com', 'dinnerin', 'tablesapp', 'covermanager', 'resy', 'opentable'] as const
const LINK_AGGREGATOR_HOSTS = ['linktr.ee', 'beacons.ai', 'solo.to', 'campsite.bio']

function hostname(value: string | null) {
  try { return value ? new URL(value).hostname.toLowerCase().replace(/^www\./, '') : null } catch { return null }
}

function hostedBy(value: string | null, hosts: readonly string[]) {
  const host = hostname(value)
  return Boolean(host && hosts.some((item) => host === item || host.endsWith(`.${item}`)))
}

function normalizedUrl(value: string): string | null {
  try {
    const url = new URL(value)
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

function instagramProfileUrl(value: string): string | null {
  const candidate = value.trim()
  if (/^@?[a-z0-9._]{1,30}$/i.test(candidate)) {
    const handle = candidate.replace(/^@/, '').toLowerCase()
    return `https://www.instagram.com/${handle}/`
  }
  try {
    const url = new URL(/^instagram\.com\//i.test(candidate) ? `https://${candidate}` : candidate)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const handle = url.pathname.split('/').filter(Boolean)[0]
    if ((host !== 'instagram.com' && host !== 'instagr.am') || !handle || /^(p|reel|stories|explore)$/i.test(handle)) return null
    return `https://www.instagram.com/${handle.toLowerCase()}/`
  } catch {
    return null
  }
}

function instagramHandle(value: string): string | null {
  return instagramProfileUrl(value)?.split('/').filter(Boolean).at(-1) ?? null
}

function canonical(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function samePlaceName(expected: string, actual: string): boolean {
  const left = canonical(expected).replace(/[^a-z0-9]+/g, ' ').trim()
  const right = canonical(actual).replace(/[^a-z0-9]+/g, ' ').trim()
  return Boolean(left && right && (left === right || left.length >= 5 && right.includes(left) || right.length >= 5 && left.includes(right)))
}

function instagramProfileMatches(details: GooglePlaceDetailsResponse, profile: InstagramProfileData): boolean {
  const values = [profile.url, profile.name, profile.bio, ...profile.links, ...(profile.posts ?? [])]
  const normalized = canonical(values.join(' '))
  if (/\bbrasil\b|\bbrazil\b|\bargentina\b|\bbuenos aires\b|\.br\b|\.ar\b/.test(normalized)) return false
  const hasName = samePlaceName(details.anchor.name, profile.name)
  const hasLocalSignal = /\bmontevideo\b|\buruguay\b|\buru\b|\b(?:uy|mvd)\b/.test(normalized)
  const addressNumbers = canonical(details.anchor.address).match(/\b\d{2,}\b/g) ?? []
  const hasAddress = addressNumbers.some((number) => new RegExp(`\\b${number}\\b`).test(normalized))
  const officialHost = hostname(details.websiteUri)
  const hasWebsiteCrossLink = Boolean(officialHost && !instagramProfileUrl(details.websiteUri ?? '') && profile.links.some((link) => hostname(link) === officialHost))
  return hasName && (hasLocalSignal || hasAddress || hasWebsiteCrossLink)
}

function matchesPlaceDomain(host: string, name: string): boolean {
  const hostValue = canonical(host).replace(/[^a-z0-9]/g, '')
  const nameValue = canonical(name).replace(/[^a-z0-9]/g, '')
  if (nameValue.length >= 5 && hostValue.includes(nameValue)) return true
  const words = canonical(name).split(/[^a-z0-9]+/).filter((word) => word.length >= 4)
  return words.length > 0 && words.every((word) => hostValue.includes(word))
}

export function classifyContact(contact: PlaceExtraction['contact']) {
  const normalized = { ...contact }
  if (normalized.website && /^https?:\/\/(?:wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\//i.test(normalized.website)) {
    normalized.whatsapp ??= normalized.website
    normalized.website = null
  } else if (normalized.website && hostedBy(normalized.website, DEFAULT_RESERVATION_HOSTS)) {
    normalized.reservationUrl ??= normalized.website
    normalized.website = null
  } else if (normalized.website && hostedBy(normalized.website, LINK_AGGREGATOR_HOSTS)) {
    normalized.website = null
  }
  return normalized
}

function isBlockedSource(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    return host.split('.').includes('tripadvisor') || BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))
  } catch {
    return true
  }
}

export function classifySource(url: string, context: SourceContext): SourceKind | 'blocked' {
  if (isBlockedSource(url)) return 'blocked'
  const host = hostname(url)
  if (!host) return 'blocked'
  const instagram = instagramProfileUrl(url)
  if (instagram) return context.instagramUrls?.some((value) => instagramProfileUrl(value) === instagram) ? 'instagram' : 'blocked'
  if (hostedBy(url, DEFAULT_RESERVATION_HOSTS)) return 'reservations'
  const knownWebsite = hostname(context.websiteUrl ?? null)
  if (knownWebsite === host) return 'web'
  if (DIRECTORY_HOSTS.some((directory) => host === directory || host.endsWith(`.${directory}`) || host.split('.').includes(directory))) return 'directory'
  return matchesPlaceDomain(host, context.name) ? 'web' : 'directory'
}

export function filterSources(sources: SourceCandidate[]): Source[] {
  return sources.flatMap((source) => {
    if (source.kind === 'blocked' || !source.text.trim() || (source.kind !== 'exa' && isBlockedSource(source.url))) return []
    const trust = source.trust ?? (source.kind === 'web' || source.kind === 'instagram' ? 'official' : 'third_party')
    return [{ ...source, trust } as Source]
  })
}

function reindexSources(sources: Source[]): Source[] {
  return sources.map((source, index) => ({ ...source, id: `S${index + 1}` }))
}

type SourceTextStats = {
  beforeChars: number
  afterChars: number
  estimatedInputTokensBefore: number
  estimatedInputTokensAfter: number
  estimatedInputTokensSaved: number
}

function estimatedTokens(characters: number) {
  return Math.ceil(characters / 4)
}

export function deduplicateSourceText(sources: Source[]): { sources: Source[]; stats: SourceTextStats } {
  const beforeChars = sources.reduce((total, source) => total + source.text.length, 0)
  const seenLines = new Set<string>()
  const deduplicated = sources.flatMap((source) => {
    const text = source.text.split(/\r?\n/).flatMap((line) => {
      const normalized = canonical(line).replace(/\s+/g, ' ').trim()
      if (!normalized || seenLines.has(normalized)) return []
      seenLines.add(normalized)
      return [line]
    }).join('\n').trim()
    return text ? [{ ...source, text }] : []
  })
  const afterChars = deduplicated.reduce((total, source) => total + source.text.length, 0)
  const estimatedInputTokensBefore = estimatedTokens(beforeChars)
  const estimatedInputTokensAfter = estimatedTokens(afterChars)
  return {
    sources: reindexSources(deduplicated),
    stats: {
      beforeChars,
      afterChars,
      estimatedInputTokensBefore,
      estimatedInputTokensAfter,
      estimatedInputTokensSaved: Math.max(0, estimatedInputTokensBefore - estimatedInputTokensAfter),
    },
  }
}

export type ParsedHours = { raw: string | null; slots: HoursSlot[]; sourceId: string; trust: SourceTrust }

const DAY_NAMES: Record<string, number> = {
  sun: 0, sunday: 0, dom: 0, domingo: 0,
  mon: 1, monday: 1, lun: 1, lunes: 1,
  tue: 2, tues: 2, tuesday: 2, mar: 2, martes: 2,
  wed: 3, wednesday: 3, mie: 3, miercoles: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, jue: 4, jueves: 4,
  fri: 5, friday: 5, vie: 5, viernes: 5,
  sat: 6, saturday: 6, sab: 6, sabado: 6,
}

const UNAVAILABLE_HOURS = new Set([
  'not available',
  'n/a',
  'na',
  'no disponible',
  'horario no disponible',
  'horarios no disponibles',
  'sin horario disponible',
])

function isUnavailableHours(value: string | null | undefined) {
  return Boolean(value && UNAVAILABLE_HOURS.has(canonical(value).replace(/\./g, '').replace(/\s+/g, ' ').trim()))
}

export function daysFromRange(value: string): number[] {
  const normalized = canonical(value).replace(/\./g, '').replace(/\s+/g, ' ').trim()
  if (/^(every day|daily|todos? los dias)$/.test(normalized)) return [0, 1, 2, 3, 4, 5, 6]
  const match = normalized.match(/^([a-z]+)\s*(?:-|–|—|to|a)\s*([a-z]+)$/)
  if (match) {
    const start = DAY_NAMES[match[1]]
    const end = DAY_NAMES[match[2]]
    if (start === undefined || end === undefined) return []
    const days: number[] = []
    let day = start
    do {
      days.push(day)
      day = (day + 1) % 7
    } while (day !== (end + 1) % 7)
    return days
  }
  const day = DAY_NAMES[normalized]
  return day === undefined ? [] : [day]
}

export function expandHourRanges(ranges: HoursRange[]): HoursSlot[] {
  return ranges.flatMap(({ days, opens, closes }) =>
    daysFromRange(days).map((day) => ({ day, opens, closes })),
  )
}

const DISPLAY_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const
const DISPLAY_DAY_NAMES = {
  es: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
} as const

function displayScheduleKey(slots: HoursSlot[]) {
  return slots
    .sort((left, right) => left.opens.localeCompare(right.opens) || (left.closes ?? '').localeCompare(right.closes ?? ''))
    .map((slot) => `${slot.opens}:${slot.closes ?? ''}`)
    .join('|')
}

function displayPeriods(slots: HoursSlot[], language: 'es' | 'en') {
  return [...slots]
    .sort((left, right) => left.opens.localeCompare(right.opens) || (left.closes ?? '').localeCompare(right.closes ?? ''))
    .map((slot) => slot.closes
      ? `${slot.opens}–${slot.closes}`
      : language === 'es' ? `Desde las ${slot.opens}` : `From ${slot.opens}`)
    .join(language === 'es' ? ' y ' : ' and ')
}

function displayDayRange(days: number[], language: 'es' | 'en') {
  if (days.length === 7) return language === 'es' ? 'Todos los días' : 'Every day'
  const names = DISPLAY_DAY_NAMES[language]
  const start = names[days[0]]
  if (days.length === 1) return start
  const end = names[days.at(-1)!]
  return language === 'es' ? `${start} a ${end.toLowerCase()}` : `${start} to ${end}`
}

function displayFromSlots(slots: HoursSlot[]): { es: string; en: string } | null {
  const byDay = new Map<number, HoursSlot[]>()
  for (const slot of slots) byDay.set(slot.day, [...(byDay.get(slot.day) ?? []), slot])

  type DayGroup = { days: number[]; slots: HoursSlot[]; key: string }
  const groups: DayGroup[] = []
  for (const day of DISPLAY_DAY_ORDER) {
    const daySlots = byDay.get(day)
    if (!daySlots || daySlots.length === 0) continue
    const key = displayScheduleKey(daySlots)
    const previous = groups.at(-1)
    if (previous && previous.key === key && previous.days.at(-1)! === DISPLAY_DAY_ORDER[DISPLAY_DAY_ORDER.indexOf(day) - 1]) {
      previous.days.push(day)
    } else {
      groups.push({ days: [day], slots: daySlots, key })
    }
  }
  if (groups.length === 0) return null
  const format = (language: 'es' | 'en') => groups
    .map((group) => `${displayDayRange(group.days, language)}: ${displayPeriods(group.slots, language)}`)
    .join('; ')
  return { es: format('es'), en: format('en') }
}

function parseMeridiemTime(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2})(?:(?::|\.)(\d{2}))?\s*(?:h(?:s|rs|oras?)?\.?)?\s*(AM|PM|a\.\s*m\.|p\.\s*m\.)?$/i)
  if (!match) return null
  let hours = Number(match[1])
  const minutes = Number(match[2] ?? '0')
  const meridiem = match[3]?.replace(/\W/g, '').toUpperCase()
  if (minutes > 59 || hours > 23 || hours < 0) return null
  if (meridiem) {
    if (hours < 1 || hours > 12) return null
    if (meridiem === 'PM' && hours !== 12) hours += 12
    if (meridiem === 'AM' && hours === 12) hours = 0
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

type HoursParseContext = { city: string; address: string }

const DAILY_HOURS_PATTERN = /(?:([^:\n]+):\s*)?(?:every day|daily|todos? los d[ií]as)\s*(?:[:,]?\s*(?:de\s*)?)?(\d{1,2}(?:(?::|\.)\d{2})?\s*(?:h(?:s|rs|oras?)?\.?)?\s*(?:a\.\s*m\.|p\.\s*m\.|am|pm)?)\s*(?:-|–|—|a|to)\s*(\d{1,2}(?:(?::|\.)\d{2})?\s*(?:h(?:s|rs|oras?)?\.?)?\s*(?:a\.\s*m\.|p\.\s*m\.|am|pm)?)/gi

function isLocationPrefix(value: string) {
  return !/\b(?:horarios?|hours?|opening hours?)\b/i.test(value)
}

function matchesHoursLocation(value: string, context: HoursParseContext) {
  const prefix = canonical(value)
  const candidates = [context.city, context.address].map(canonical)
  return candidates.some((candidate) => candidate.length > 1 && (prefix.includes(candidate) || candidate.includes(prefix)))
}

export function parseExplicitHours(sources: Source[], context?: HoursParseContext): ParsedHours[] {
  const parsed: ParsedHours[] = []
  for (const source of sources) {
    if (isUnavailableHours(source.hoursRaw)) continue
    const rawIsApproximate = Boolean(source.hoursRaw && APPROXIMATE_HOURS.test(source.hoursRaw))
    if (!rawIsApproximate && source.hoursSlots && source.hoursSlots.length > 0) {
      const slots = expandHourRanges(source.hoursSlots)
      if (slots.length > 0) {
        parsed.push({ raw: source.hoursRaw?.trim() || null, slots, sourceId: source.id, trust: source.trust })
        continue
      }
    }
    if (source.hoursRaw?.trim()) {
      parsed.push({ raw: source.hoursRaw.trim(), slots: [], sourceId: source.id, trust: source.trust })
    }
    for (const line of source.text.split(/\r?\n/)) {
      if (APPROXIMATE_HOURS.test(line)) continue
      for (const match of line.matchAll(DAILY_HOURS_PATTERN)) {
        const prefix = match[1]?.trim()
        if (context && prefix && isLocationPrefix(prefix) && !matchesHoursLocation(prefix, context)) continue
        const opens = parseMeridiemTime(match[2])
        const closes = parseMeridiemTime(match[3])
        if (!opens || !closes) continue
        parsed.push({
          raw: match[0].trim(),
          slots: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, opens, closes })),
          sourceId: source.id,
          trust: source.trust,
        })
      }
    }
  }
  return parsed
}

function sourceFromExa(exa: ExaPlaceResponse): SourceCandidate[] {
  return exa.results.map((result) => ({
    id: '',
    // El contenido vino de Exa aunque la URL apunte a una web propia: se trata
    // como señal de terceros hasta que esa web se scrapea directamente.
    kind: isBlockedSource(result.url) ? 'blocked' : 'exa',
    trust: 'third_party',
    url: result.url,
    text: result.text?.trim() || result.highlights.join('\n'),
    links: result.extras?.links,
  }))
}

function sourceFromExaSummary(exa: ExaPlaceResponse): SourceCandidate {
  const content = exa.output.content
  return {
    id: '',
    kind: 'exa',
    trust: 'third_party',
    url: 'https://exa.ai/',
    text: [
      'RESUMEN ESTRUCTURADO DE EXA',
      `Descripción: ${content.description}`,
      `Dirección: ${content.address}`,
      `Contacto: ${content.contact_info}`,
      `Horarios (texto original): ${content.open_hours_raw}`,
      content.open_hours.length ? `Horarios estructurados:\n${content.open_hours.map((hours) => `${hours.days}: ${hours.opens} - ${hours.closes ?? 'sin cierre publicado'}`).join('\n')}` : '',
      `Antes de ir: ${content.knows_before_you_go}`,
      content.menu.length ? `Menú:\n${content.menu.join('\n')}` : '',
    ].filter(Boolean).join('\n'),
    hoursRaw: content.open_hours_raw,
    hoursSlots: content.open_hours,
    menu: content.menu,
    exaDescription: content.description,
    exaKnowsBeforeYouGo: content.knows_before_you_go,
  }
}

function sourceFromWebsite(page: WebsitePageData): SourceCandidate {
  return {
    id: '',
    kind: 'web',
    trust: 'official',
    url: page.url,
    text: [page.title, page.description, page.content].filter(Boolean).join('\n'),
    links: page.links,
  }
}

function instagramCandidates(details: GooglePlaceDetailsResponse, exa: ExaPlaceResponse | null): string[] {
  const instagramFromContactInfo = (value: string) => {
    const urls = value.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/[A-Za-z0-9._]{1,30}\/?/gi) ?? []
    const labeledHandles = [...value.matchAll(/instagram\s*[:-]?\s*@?([A-Za-z0-9._]{1,30})/gi)].map((match) => `@${match[1]}`)
    return [...urls, ...labeledHandles]
  }
  const values = [
    details.websiteUri ?? '',
    ...instagramFromContactInfo(exa?.output.content.contact_info ?? ''),
    ...(exa?.results.flatMap((result) => [result.url, ...(result.extras?.links ?? [])]) ?? []),
  ]
  return [...new Set(values.map(instagramProfileUrl).filter((value): value is string => Boolean(value)))]
}

type InstagramValidation = { profile: InstagramProfileData | null; candidates: InstagramAuditCandidate[] }

async function validatedInstagram(
  provider: InstagramProvider | undefined,
  details: GooglePlaceDetailsResponse,
  candidates: string[],
): Promise<InstagramValidation> {
  const handles = candidates.map(instagramHandle).filter((handle): handle is string => Boolean(handle))
  if (candidates.length === 0) return { profile: null, candidates: [] }
  if (!provider?.configured) return {
    profile: null,
    candidates: handles.map((handle) => ({ handle, decision: 'unavailable', reason: 'instagram_provider_not_configured' })),
  }
  let profiles: InstagramProfileData[]
  try {
    profiles = await provider.scrapeMany(candidates)
  } catch {
    return {
      profile: null,
      candidates: handles.map((handle) => ({ handle, decision: 'unavailable', reason: 'instagram_provider_failed' })),
    }
  }
  const requestedProfiles = new Set(candidates.map(instagramProfileUrl).filter(Boolean))
  const accepted = profiles.flatMap((profile) => {
    const profileUrl = instagramProfileUrl(profile.url)
    if (!profileUrl || !requestedProfiles.has(profileUrl)) return []
    if (!instagramProfileMatches(details, profile)) return []
    return [{ ...profile, url: profileUrl }]
  })
  const unique = new Map(accepted.flatMap((profile) => {
    return [[profile.url, profile] as const]
  }))
  const selected = unique.size === 1 ? [...unique.values()][0] : null
  const acceptedUrls = new Set(accepted.map((profile) => profile.url))
  return {
    profile: selected,
    candidates: candidates.flatMap((candidate): InstagramAuditCandidate[] => {
      const url = instagramProfileUrl(candidate)
      const handle = url && instagramHandle(url)
      if (!url || !handle) return []
      if (selected?.url === url) return [{ handle, decision: 'selected' as const, reason: 'validated_exact_place_profile' }]
      if (acceptedUrls.has(url)) return [{ handle, decision: 'discarded' as const, reason: 'multiple_valid_profiles' }]
      const profile = profiles.find((item) => instagramProfileUrl(item.url) === url)
      return [{ handle, decision: 'discarded' as const, reason: profile ? 'identity_or_location_mismatch' : 'not_returned_by_provider' }]
    }),
  }
}

function sourceFromInstagram(profile: InstagramProfileData): SourceCandidate {
  const handle = instagramHandle(profile.url) ?? ''
  return {
    id: '',
    kind: 'instagram',
    trust: 'official',
    url: profile.url,
    text: [`Handle: ${handle}`, profile.name, profile.bio, ...(profile.posts ?? []), ...profile.links].filter(Boolean).join('\n'),
    links: profile.links,
  }
}

function prompt(target: Target, sources: Source[]) {
  const sourceBlocks = sources.map((source) => `<source id="${source.id}" type="${source.kind}" trust="${source.trust === 'official' ? 'OFICIAL' : 'TERCEROS'}" url="${source.url}">\n${source.text.slice(0, MAX_CHARS_PER_SOURCE)}\n</source>`).join('\n\n')
  return `LOCAL OBJETIVO\nNombre: ${target.name}\nDirección: ${target.address}\nBarrio: ${target.neighborhoodId ?? 'No identificado'}, Montevideo, Uruguay\nCoordenadas: ${target.coordinates.lat}, ${target.coordinates.lng}\n\nFUENTES\n${sourceBlocks}\n\nExtraé información útil y razonable a partir de las fuentes, respetando su prioridad.`
}

async function generatePlaceExtraction(target: Target, sources: Source[]) {
  const result = await generateText({
    model: `openai/${MODEL}`,
    output: Output.object({ schema: PlaceExtraction }),
    system: SYSTEM_PROMPT,
    prompt: prompt(target, sources),
    temperature: 0,
    providerOptions: { openai: { reasoningEffort: 'low' } },
  })
  return {
    data: result.output,
    inputTokens: result.usage?.inputTokens ?? null,
    outputTokens: result.usage?.outputTokens ?? null,
  }
}

function generatedData(value: PlaceExtraction | GeneratedExtraction): GeneratedExtraction {
  return 'data' in value ? value : { data: value, inputTokens: null, outputTokens: null }
}

function addUnique<T extends string>(values: T[], value: T) {
  if (!values.includes(value)) values.push(value)
}

function hasPhrase(text: string, phrase: string) {
  const words = (value: string) => canonical(value).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
  const haystack = ` ${words(text)} `
  const needle = words(phrase)
  return needle.length > 1 && haystack.includes(` ${needle} `)
}

function retainSourceMentionedTags<T extends string>(
  values: T[],
  definitions: Record<T, { label: { es: string; en: string }; synonyms: { es: string[]; en: string[] } }>,
  text: string,
) {
  return values.filter((id) => {
    const definition = definitions[id]
    return tagTerms(definition).some((term) => hasPhrase(text, term))
  })
}

function tagTerms(definition: { label: { es: string; en: string }; synonyms: { es: string[]; en: string[] } }) {
  return [definition.label.es, definition.label.en, ...definition.synonyms.es, ...definition.synonyms.en]
}

type ProcessedExtraction = Omit<PlaceExtraction, 'hours'> & {
  hours: { raw: string | null; display: { es: string; en: string } | null; slots: HoursSlot[] }
}

const AMBIGUOUS_FOOD_SYNONYMS = new Set(['carne', 'carnes'])

function spanishFoodTerms(definition: typeof FOODS[keyof typeof FOODS]) {
  return [definition.label.es, ...definition.synonyms.es]
    .filter((term) => !AMBIGUOUS_FOOD_SYNONYMS.has(canonical(term)))
}

function appendFoodsFromExaMenus(result: Pick<ProcessedExtraction, 'foods'>, sources: Source[]) {
  const menuItems = sources
    .filter((source) => source.kind === 'exa')
    .flatMap((source) => source.menu ?? [])
  for (const [id, definition] of Object.entries(FOODS) as [keyof typeof FOODS, typeof FOODS[keyof typeof FOODS]][]) {
    const terms = [...spanishFoodTerms(definition), definition.label.en, ...definition.synonyms.en]
    if (menuItems.some((item) => terms.some((term) => hasPhrase(item, term)))) addUnique(result.foods, id)
  }
}

function appendCuisinesFromExa(result: Pick<ProcessedExtraction, 'cuisines'>, sources: Source[]) {
  const exaCuisines: (keyof typeof CUISINES)[] = []
  for (const source of sources) {
    if (source.kind !== 'exa') continue
    for (const text of [source.exaDescription, ...(source.menu ?? [])]) {
      if (!text) continue
      for (const [id, definition] of Object.entries(CUISINES) as [keyof typeof CUISINES, typeof CUISINES[keyof typeof CUISINES]][]) {
        if (tagTerms(definition).some((term) => hasPhrase(text, term))) addUnique(exaCuisines, id)
      }
    }
  }
  if (exaCuisines.length > 0) {
    result.cuisines = [...exaCuisines, ...result.cuisines.filter((id) => !exaCuisines.includes(id))].slice(0, 3)
  }
}

const AMBIGUOUS_DRINK_SYNONYMS = new Set(['canilla', 'barra', 'copas', 'after', 'tragos', 'cerveza'])
const SIGNATURE_COCKTAIL_SIGNALS = ['cocktail bar', 'bar de tragos', 'bar de cócteles', 'craft cocktails', 'coctelería de autor', 'tragos de autor']

function drinkTerms(definition: typeof DRINKS[keyof typeof DRINKS]) {
  return tagTerms(definition).filter((term) => !AMBIGUOUS_DRINK_SYNONYMS.has(canonical(term)))
}

function withoutSignatureCocktailSignals(text: string) {
  return SIGNATURE_COCKTAIL_SIGNALS.reduce(
    (remaining, signal) => remaining.replaceAll(canonical(signal), ' '),
    canonical(text),
  )
}

function appendDrinksFromTexts(result: Pick<ProcessedExtraction, 'drinks'>, texts: string[]) {
  for (const text of texts) {
    const classicText = withoutSignatureCocktailSignals(text)
    for (const [id, definition] of Object.entries(DRINKS) as [keyof typeof DRINKS, typeof DRINKS[keyof typeof DRINKS]][]) {
      const searchableText = id === 'classic_cocktails' ? classicText : text
      if (drinkTerms(definition).some((term) => hasPhrase(searchableText, term))) addUnique(result.drinks, id)
    }
  }
}

function appendDrinksFromExaAndHighlights(result: Pick<ProcessedExtraction, 'drinks' | 'highlights'>, sources: Source[]) {
  const exaTexts = sources
    .filter((source) => source.kind === 'exa')
    .flatMap((source) => [source.exaDescription, source.exaKnowsBeforeYouGo, ...(source.menu ?? [])])
    .filter((text): text is string => Boolean(text))
  appendDrinksFromTexts(result, exaTexts)
  appendDrinksFromTexts(result, result.highlights.flatMap((highlight) => [highlight.es, highlight.en]))
}

const AMBIGUOUS_FEATURE_SYNONYMS = new Set(['barra'])

function featureTerms(definition: typeof FEATURES[keyof typeof FEATURES]) {
  return tagTerms(definition).filter((term) => !AMBIGUOUS_FEATURE_SYNONYMS.has(canonical(term)))
}

function appendFeaturesFromExa(result: Pick<ProcessedExtraction, 'features'>, sources: Source[]) {
  const exaTexts = sources
    .filter((source) => source.kind === 'exa')
    .flatMap((source) => [source.exaDescription, source.exaKnowsBeforeYouGo, ...(source.menu ?? [])])
    .filter((text): text is string => Boolean(text))
  for (const text of exaTexts) {
    for (const [id, definition] of Object.entries(FEATURES) as [keyof typeof FEATURES, typeof FEATURES[keyof typeof FEATURES]][]) {
      if (featureTerms(definition).some((term) => hasPhrase(text, term))) addUnique(result.features, id)
    }
  }
}

function applyRestaurantCategoryImplication(result: Pick<ProcessedExtraction, 'categories'>) {
  if (result.categories.some((category) => category === 'grill' || category === 'pizzeria' || category === 'chiviteria')) {
    addUnique(result.categories, 'restaurant')
  }
}

function appendCategoryFoodsAndCuisines(result: Pick<ProcessedExtraction, 'categories' | 'foods' | 'cuisines'>) {
  if (result.categories.includes('grill')) {
    addUnique(result.foods, 'grilled_meat')
    addUnique(result.cuisines, 'uruguayan')
  }
  if (result.categories.includes('pizzeria')) addUnique(result.foods, 'pizza')
  if (result.categories.includes('chiviteria')) addUnique(result.foods, 'chivito')
  if (result.categories.includes('ice_cream_shop')) addUnique(result.foods, 'ice_cream')
}

function appendFoodsFromSpanishHighlights(result: Pick<ProcessedExtraction, 'foods' | 'highlights'>) {
  for (const [id, definition] of Object.entries(FOODS) as [keyof typeof FOODS, typeof FOODS[keyof typeof FOODS]][]) {
    const terms = spanishFoodTerms(definition)
    if (result.highlights.some((highlight) => terms.some((term) => hasPhrase(highlight.es, term)))) addUnique(result.foods, id)
  }
}

const FULLY_VEGETARIAN_SIGNALS = ['restaurante vegetariano', 'vegetarian restaurant', '100% vegetariano', 'restaurante vegano y vegetariano', 'vegan and vegetarian']
const VEGAN_OPTIONS_SIGNALS = ['vegano y vegetariano', 'vegan and vegetarian', 'opciones veganas']
const FULLY_VEGAN_SIGNALS = ['100% vegano', '100% vegan', 'todo vegano', 'totalmente vegano', 'plant-based restaurant']
const VEGAN_RESTAURANT_SIGNAL = 'restaurante vegano'
const NON_VEGAN_CHEESE_TERMS = ['queso', 'cheese']
const VEGAN_CHEESE_PHRASES = ['queso vegano', 'vegan cheese']
const NON_VEGAN_INGREDIENT_TERMS = ['huevo', 'egg', 'manteca', 'butter', 'leche', 'milk', 'miel', 'honey', 'crema', 'cream']

function hasNonVeganIngredient(value: string) {
  const withoutVeganCheese = VEGAN_CHEESE_PHRASES.reduce(
    (text, phrase) => text.replaceAll(phrase, ''),
    canonical(value),
  )
  const nonVeganCheese = NON_VEGAN_CHEESE_TERMS.some((term) => hasPhrase(withoutVeganCheese, term))
  return nonVeganCheese || NON_VEGAN_INGREDIENT_TERMS.some((term) => hasPhrase(value, term))
}

function applyDietaryVenueRules(result: Pick<ProcessedExtraction, 'dietary' | 'foods' | 'highlights'>, sources: Source[]) {
  const text = sources.map((source) => source.text).join('\n')
  const vegetarianFully = FULLY_VEGETARIAN_SIGNALS.some((signal) => hasPhrase(text, signal))
  const veganOptions = VEGAN_OPTIONS_SIGNALS.some((signal) => hasPhrase(text, signal))
  const veganRestaurantOnly = hasPhrase(text, VEGAN_RESTAURANT_SIGNAL) &&
    !hasPhrase(text, 'vegetariano') && !hasPhrase(text, 'vegetarian')
  const veganFully = FULLY_VEGAN_SIGNALS.some((signal) => hasPhrase(text, signal)) || veganRestaurantOnly

  if (vegetarianFully) result.dietary.vegetarian = 'fully'
  if (veganFully) result.dietary.vegan = 'fully'
  else if (veganOptions || result.dietary.vegan === 'fully') result.dietary.vegan = 'has_options'
  if (result.dietary.vegan === 'fully') result.dietary.vegetarian = 'fully'

  const menuItems = sources.filter((source) => source.kind === 'exa').flatMap((source) => source.menu ?? [])
  if (result.dietary.vegan === 'fully' && [...menuItems, ...result.highlights.flatMap((highlight) => [highlight.es, highlight.en])].some(hasNonVeganIngredient)) {
    result.dietary.vegan = 'has_options'
  }
  if (result.dietary.vegan === 'fully' || result.dietary.vegetarian === 'fully') {
    result.foods = result.foods.filter((food) => food !== 'grilled_meat')
  }
}

const RESERVATION_TERMS = ['reserva', 'reservas', 'reservation', 'reservations']
const NEGATIVE_RESERVATION_PHRASES = [
  'sin reserva',
  'sin reservas',
  'no se acepta reserva',
  'no se aceptan reservas',
  'no reservations',
  'reservations not accepted',
]

function hasReservationSignal(text: string) {
  return RESERVATION_TERMS.some((term) => hasPhrase(text, term)) &&
    !NEGATIVE_RESERVATION_PHRASES.some((phrase) => hasPhrase(text, phrase))
}

function minutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function isOpenAt(hours: HoursSlot[], at: number) {
  return hours.some((entry) => {
    if (!entry.closes) return false
    const opens = minutes(entry.opens)
    const closes = minutes(entry.closes)
    return closes > opens ? opens <= at && at <= closes : opens <= at || at <= closes
  })
}

const DETERMINISTIC_CATEGORY_SIGNALS: readonly [string, CategoryId][] = [
  ['wine bar', 'wine_bar'],
  ['bar de vinos', 'wine_bar'],
  ['vinoteca', 'wine_bar'],
  ['cervecería', 'brewery'],
  ['brewpub', 'brewery'],
  ['taproom', 'brewery'],
  ['cafetería', 'cafe'],
  ['coffee shop', 'cafe'],
]

type PriceTier = PlaceExtraction['price']
type PriceCandidate = { value: number; trust: SourceTrust }

const PRICE_CURRENCY = '(?:uyu|u\\$|\\$)'
const PRICE_AMOUNT = '([0-9]{1,3}(?:[.,\\s][0-9]{3})+|[0-9]+)'
const PRICE_RANGE = new RegExp(
  `(?:entre\\s+)?${PRICE_CURRENCY}\\s*${PRICE_AMOUNT}\\s*(?:a|al|y|hasta|[-–])\\s*${PRICE_CURRENCY}\\s*${PRICE_AMOUNT}`,
  'gi',
)
const PRICE_SINGLE = new RegExp(`${PRICE_CURRENCY}\\s*${PRICE_AMOUNT}`, 'gi')
const PRICE_CONTEXT = /(?:precio|por\s+persona|por\s+comensal|p\/\s*persona|ticket\s+promedio)/i
const FOREIGN_CURRENCY = /(?:us\s*\$|\busd\b|\bd[oó]lares?\b|\beur\b|€)/i

function parseUruguayPrice(value: string) {
  return Number(value.replace(/[.,\s]/g, ''))
}

function hasPriceContext(text: string, start: number, end: number) {
  const before = text.slice(0, start)
  const after = text.slice(end)
  const sentenceStart = Math.max(before.lastIndexOf('.'), before.lastIndexOf(';'), before.lastIndexOf('!'), before.lastIndexOf('?'), before.lastIndexOf('\n')) + 1
  const sentenceEndOffset = [after.indexOf('.'), after.indexOf(';'), after.indexOf('!'), after.indexOf('?'), after.indexOf('\n')]
    .filter((index) => index >= 0)
    .reduce((nearest, index) => Math.min(nearest, index), after.length)
  return PRICE_CONTEXT.test(text.slice(sentenceStart, end + sentenceEndOffset))
}

function hasForeignCurrency(text: string, start: number, end: number) {
  return FOREIGN_CURRENCY.test(text.slice(Math.max(0, start - 8), Math.min(text.length, end + 8)))
}

function pricesInText(text: string, trust: SourceTrust): PriceCandidate[] {
  const candidates: PriceCandidate[] = []
  const rangeSpans: { start: number; end: number }[] = []
  for (const match of text.matchAll(PRICE_RANGE)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (!hasPriceContext(text, start, end) || hasForeignCurrency(text, start, end)) continue
    const low = parseUruguayPrice(match[1])
    const high = parseUruguayPrice(match[2])
    if (!Number.isFinite(low) || !Number.isFinite(high)) continue
    candidates.push({ value: (low + high) / 2, trust })
    rangeSpans.push({ start, end })
  }
  for (const match of text.matchAll(PRICE_SINGLE)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (rangeSpans.some((span) => start >= span.start && end <= span.end)) continue
    if (!hasPriceContext(text, start, end) || hasForeignCurrency(text, start, end)) continue
    const value = parseUruguayPrice(match[1])
    if (Number.isFinite(value)) candidates.push({ value, trust })
  }
  return candidates
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function deterministicPrice(sources: Source[]): PriceTier | null {
  const candidates = sources.flatMap((source) => pricesInText(source.text, source.trust))
  const official = candidates.filter((candidate) => candidate.trust === 'official')
  const selected = official.length > 0 ? official : candidates
  if (selected.length === 0) return null
  const value = median(selected.map((candidate) => candidate.value))
  if (value < 600) return 'low'
  if (value < 1200) return 'moderate'
  if (value <= 2500) return 'high'
  return 'very_high'
}

function applyConsistencyRules(result: ProcessedExtraction, sources: Source[]) {
  const allText = sources.map((source) => source.text).join('\n')
  for (const [phrase, category] of DETERMINISTIC_CATEGORY_SIGNALS) {
    if (hasPhrase(allText, phrase)) addUnique(result.categories, category)
  }
  // restaurant debe estar presente antes de las reglas de moments que dependen de ella.
  applyRestaurantCategoryImplication(result)
  result.foods = retainSourceMentionedTags(result.foods, FOODS, allText)
  result.cuisines = retainSourceMentionedTags(result.cuisines, CUISINES, allText)
  appendCategoryFoodsAndCuisines(result)
  appendCuisinesFromExa(result, sources)
  appendFoodsFromExaMenus(result, sources)
  appendFoodsFromSpanishHighlights(result)
  appendDrinksFromExaAndHighlights(result, sources)
  appendFeaturesFromExa(result, sources)
  if (result.categories.includes('bar') && SIGNATURE_COCKTAIL_SIGNALS.some((signal) => hasPhrase(allText, signal))) {
    addUnique(result.drinks, 'signature_cocktails')
    addUnique(result.drinks, 'classic_cocktails')
  }
  if (sources.some((source) => hasReservationSignal(source.text))) result.reservations = 'accepts'
  applyDietaryVenueRules(result, sources)
  if (hasPhrase(allText, 'platitos') || hasPhrase(allText, 'para compartir') || hasPhrase(allText, 'tablas')) addUnique(result.foods, 'picada')
  const outdoorFeatures = ['terrace', 'patio', 'sidewalk'] as const
  // La evidencia textual directa de un patio debe sobrevivir aunque el modelo
  // no haya emitido el feature ni outdoorSeating.
  if (hasPhrase(allText, 'patio') || hasPhrase(allText, 'shared patio')) {
    addUnique(result.features, 'patio')
    result.outdoorSeating = 'yes'
  } else if (result.features.some((feature) => outdoorFeatures.includes(feature as typeof outdoorFeatures[number]))) {
    result.outdoorSeating = 'yes'
  }

  if (result.categories.includes('wine_bar')) {
    addUnique(result.drinks, 'wine')
    addUnique(result.moments, 'drinks')
  }
  if (result.categories.some((category) => category === 'bar' || category === 'brewery')) {
    addUnique(result.moments, 'drinks')
  }
  if (result.categories.includes('brewery')) {
    addUnique(result.drinks, hasPhrase(allText, 'cerveza artesanal') || hasPhrase(allText, 'craft beer') ? 'craft_beer' : 'draft_beer')
  }
  if (result.categories.includes('cafe') && (hasPhrase(allText, 'café de especialidad') || hasPhrase(allText, 'specialty coffee'))) {
    addUnique(result.drinks, 'specialty_coffee')
  }

  const workSignal = hasPhrase(allText, 'wifi') || hasPhrase(allText, 'enchufes') || hasPhrase(allText, 'para trabajar') ||
    result.categories.includes('cafe') && result.hours.slots.some((entry) => minutes(entry.opens) < 18 * 60) && hasPhrase(allText, 'mesas')
  if (!workSignal) result.goodFor = result.goodFor.filter((value) => value !== 'work')

  const isCafeOrBakery = result.categories.some((category) => category === 'cafe' || category === 'bakery')
  if (isCafeOrBakery) {
    addUnique(result.moments, 'breakfast')
    addUnique(result.moments, 'afternoon_snack')
  }
  if (result.categories.includes('restaurant') && result.hours.slots.some((entry) => minutes(entry.opens) < 10 * 60)) addUnique(result.moments, 'breakfast')
  if (hasPhrase(allText, 'brunch')) addUnique(result.moments, 'brunch')
  const hasMealFood = result.foods.some((food) => food !== 'picada' && food !== 'desserts')
  if (hasMealFood && result.hours.slots.some((entry) => minutes(entry.opens) <= 13 * 60)) addUnique(result.moments, 'lunch')
  const rawDinnerSignal = [result.hours.raw ?? ''].some((value) => [
    'noche', 'cena', 'dinner', 'última copa',
  ].some((phrase) => hasPhrase(value, phrase)))
  if (hasMealFood && (isOpenAt(result.hours.slots, 21 * 60) || rawDinnerSignal)) addUnique(result.moments, 'dinner')
  const isRestaurant = result.categories.includes('restaurant')
  if (isRestaurant && (result.hours.slots.some((entry) => minutes(entry.opens) < 13 * 60) || isOpenAt(result.hours.slots, 13 * 60 + 30))) {
    addUnique(result.moments, 'lunch')
  }
  if (isRestaurant && isOpenAt(result.hours.slots, 21 * 60 + 30)) addUnique(result.moments, 'dinner')
  const hasUnpublishedClose = result.hours.slots.length === 0 || result.hours.slots.some((entry) => entry.closes === null)
  const dinnerSignal = [result.hours.raw ?? '', allText].some((value) => [
    'noche', 'cena', 'dinner', 'última copa', 'until late',
  ].some((phrase) => hasPhrase(value, phrase)))
  if (isRestaurant && hasUnpublishedClose && dinnerSignal) addUnique(result.moments, 'dinner')
  if (result.hours.slots.some((entry) => {
    if (!entry.closes) return false
    const closes = minutes(entry.closes)
    return closes >= 2 * 60 && closes <= 6 * 60
  })) addUnique(result.moments, 'late_night')
}

function normalizeUruguayPhone(value: string | null) {
  if (!value) return null
  let digits = value.replace(/\D/g, '')
  if (digits.startsWith('00598')) digits = digits.slice(5)
  else if (digits.startsWith('598')) digits = digits.slice(3)
  if (digits.length === 9 && digits.startsWith('0')) digits = digits.slice(1)
  if (/^2\d{7}$/.test(digits)) return `+598 ${digits.slice(0, 4)} ${digits.slice(4)}`
  if (/^9\d{7}$/.test(digits)) return `+598 ${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`
  return null
}

function whatsappNumber(value: string | null) {
  if (!value) return null
  try {
    const url = new URL(value)
    if (/^(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)$/i.test(url.hostname.replace(/^www\./, ''))) {
      return url.searchParams.get('phone') ?? url.pathname.split('/').filter(Boolean)[0] ?? null
    }
  } catch {
    // También se aceptan números escritos directamente.
  }
  return value
}

function httpsUrl(value: string | null) {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol === 'http:') url.protocol = 'https:'
    return url.href
  } catch {
    return null
  }
}

function normalizeContact(contact: PlaceExtraction['contact']) {
  const normalizedInstagram = contact.instagram?.replace(/^@/, '').trim().toLowerCase() || null
  const instagram = contact.instagram ? instagramHandle(contact.instagram) ?? normalizedInstagram : null
  return {
    ...contact,
    phone: normalizeUruguayPhone(contact.phone),
    whatsapp: normalizeUruguayPhone(whatsappNumber(contact.whatsapp)),
    instagram,
    website: httpsUrl(contact.website),
    menuUrl: httpsUrl(contact.menuUrl),
    reservationUrl: httpsUrl(contact.reservationUrl),
  }
}

const SOCIAL_HOSTS = ['instagram.com', 'instagr.am', 'facebook.com', 'tiktok.com', 'x.com', 'twitter.com', 'linkedin.com', 'youtube.com']

export type DeterministicContact = Partial<Pick<PlaceExtraction['contact'], 'phone' | 'instagram' | 'website' | 'reservationUrl'>>

function linksInText(value: string): string[] {
  return value.match(/https?:\/\/[^\s<>"')\]]+/gi)?.map((link) => link.replace(/[.,;:!?]+$/, '')) ?? []
}

function sourceLinks(source: Source): string[] {
  return [source.url, ...(source.links ?? []), ...linksInText(source.text)]
}

function isSocialUrl(value: string) {
  return hostedBy(value, SOCIAL_HOSTS)
}

function instagramMentions(value: string): string[] {
  // El carácter anterior debe ser un separador, nunca parte de una dirección
  // de correo o de otro identificador. Además se evita aceptar puntos al final.
  return [...value.matchAll(/(?:^|[^a-z0-9._%+-])@([a-z0-9_](?:[a-z0-9._]{0,28}[a-z0-9_])?)(?![a-z0-9._])/gi)].map((match) => match[1])
}

function normalizedHandle(value: string) {
  return canonical(value)
    .replace(/[^a-z0-9]/g, '')
    .replace(/(?:uy|mvd|montevideo|uruguay)$/g, '')
}

function stringSimilarity(left: string, right: string) {
  if (!left || !right) return 0
  if (left === right) return 1
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0]
    previous[0] = i
    for (let j = 1; j <= right.length; j += 1) {
      const current = previous[j]
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + Number(left[i - 1] !== right[j - 1]),
      )
      diagonal = current
    }
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length)
}

function preferredInstagramHandle(name: string, sources: Source[], extraLinks: string[] = []): string | null {
  const candidates = [
    ...extraLinks.map(instagramHandle),
    ...sources.flatMap((source) => [
    ...sourceLinks(source).map(instagramHandle),
    ...instagramMentions(source.text).map(instagramHandle),
    ]),
  ].filter((handle): handle is string => Boolean(handle))
  const expected = normalizedHandle(name)
  const scored = [...new Set(candidates)].map((handle, index) => ({
    handle,
    index,
    score: stringSimilarity(expected, normalizedHandle(handle)),
  })).sort((left, right) => right.score - left.score || left.index - right.index)
  return scored[0]?.score >= 0.55 ? scored[0].handle : null
}

function phonesInText(value: string): string[] {
  return value.match(/(?:\+|00)?\s*(?:598\s*)?(?:0\s*)?[29](?:[\s().-]*\d){7}\b/g) ?? []
}

export function resolveDeterministicContact(
  details: GooglePlaceDetailsResponse,
  sources: Source[],
  reservationHosts: readonly string[] = DEFAULT_RESERVATION_HOSTS,
): DeterministicContact {
  const googleWebsite = details.websiteUri ? httpsUrl(details.websiteUri) : null
  const googleReservation = googleWebsite && hostedBy(googleWebsite, reservationHosts) ? googleWebsite : null
  const reservationUrl = googleReservation ?? sources
    .flatMap(sourceLinks)
    .map(httpsUrl)
    .find((url): url is string => Boolean(url && hostedBy(url, reservationHosts))) ?? null
  const website = googleWebsite && !googleReservation && !isSocialUrl(googleWebsite) &&
    !hostedBy(googleWebsite, LINK_AGGREGATOR_HOSTS) &&
    !/^https:\/\/(?:wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\//i.test(googleWebsite)
    ? googleWebsite
    : undefined
  const phone = normalizeUruguayPhone(details.phoneNumber ?? null) ?? sources
    .flatMap((source) => [...phonesInText(source.text), ...sourceLinks(source)])
    .map(normalizeUruguayPhone)
    .find((value): value is string => Boolean(value)) ?? null
  const instagram = preferredInstagramHandle(details.anchor.name, sources, details.websiteUri ? [details.websiteUri] : [])
  return {
    ...(website ? { website } : googleReservation ? { website: null } : {}),
    ...(reservationUrl ? { reservationUrl } : {}),
    ...(instagram ? { instagram } : {}),
    ...(phone ? { phone } : {}),
  }
}

export function postProcess(
  target: Target,
  data: PlaceExtraction,
  context: { sources?: Source[]; seedCategory?: CategoryId; categoryFallback?: string[]; parsedHours?: ParsedHours[]; deterministicContact?: DeterministicContact } = {},
): PlaceEnrichmentDraft {
  const sources = context.sources ?? []
  const sourcesById = new Map(sources.map((source) => [source.id, source]))
  const result = structuredClone(data)
  const clipQuote = (quote: string | null) => quote?.trim().split(/\s+/).filter(Boolean).slice(0, 15).join(' ') ?? null
  const normalizedText = (value: string) => canonical(value).replace(/\s+/g, ' ').trim()
  const textForModel = (source: Source) => source.text.slice(0, MAX_CHARS_PER_SOURCE)
  const quoteInSource = (quote: string, source: Source) => normalizedText(textForModel(source)).includes(normalizedText(quote))
  const approximateHours = (quote: string, source: Source) => {
    const text = textForModel(source)
    const normalized = normalizedText(text)
    const index = normalized.indexOf(normalizedText(quote))
    const passage = index >= 0 ? normalized.slice(Math.max(0, index - 180), index + normalizedText(quote).length + 180) : normalized
    return APPROXIMATE_HOURS.test(passage)
  }

  const movedReservation = Boolean(result.contact.website && hostedBy(result.contact.website, DEFAULT_RESERVATION_HOSTS) && !result.contact.reservationUrl)
  const movedWhatsapp = Boolean(result.contact.website && /^https?:\/\/(?:wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\//i.test(result.contact.website) && !result.contact.whatsapp)
  result.contact = classifyContact(result.contact)
  const validEvidence = data.evidence.flatMap((item) => {
    const field = movedReservation && item.field === 'contact.website'
      ? 'contact.reservationUrl'
      : movedWhatsapp && item.field === 'contact.website'
        ? 'contact.whatsapp'
        : item.field
    const source = sourcesById.get(item.sourceId)
    const quote = clipQuote(item.quote)
    if (!source || !quote || !quoteInSource(quote, source)) return []
    if (field.startsWith('hours.') && approximateHours(quote, source)) return []
    return [{ ...item, field, quote }]
  })

  const trustedInstagram = sources.filter((source) => source.kind === 'instagram' && source.trust === 'official')
  if (trustedInstagram.length === 1) {
    const handle = instagramProfileUrl(trustedInstagram[0].url)?.split('/').filter(Boolean).at(-1) ?? null
    if (handle) {
      result.contact.instagram = handle
      if (!validEvidence.some((item) => item.field === 'contact.instagram')) {
        validEvidence.push({ field: 'contact.instagram', sourceId: trustedInstagram[0].id, quote: `Handle: ${handle}` })
      }
    }
  }

  const supported = (field: string) => validEvidence.some((item) => item.field === field)
  const retainTags = <T extends string>(values: T[], field: string): T[] => values.filter((value) => supported(`${field}.${value}`))
  // Las categorías válidas del LLM y la semilla se conservan; las reglas de
  // consistencia sólo pueden agregar categorías, nunca quitarlas.
  if (context.seedCategory) addUnique(result.categories, context.seedCategory)
  result.moments = retainTags(result.moments, 'moments')
  result.cuisines = retainTags(result.cuisines, 'cuisines')
  result.foods = retainTags(result.foods, 'foods')
  result.drinks = retainTags(result.drinks, 'drinks')
  result.features = retainTags(result.features, 'features')
  result.goodFor = retainTags(result.goodFor, 'goodFor')
  result.highlights = result.highlights.filter((highlight) =>
    sources.some((source) => hasPhrase(source.text, highlight.es) || hasPhrase(source.text, highlight.en)),
  )
  // late_night jamás se toma del modelo: depende exclusivamente de cierres normalizados.
  result.moments = result.moments.filter((moment) => moment !== 'late_night')
  type HourCandidate = { raw?: string | null; slot?: HoursSlot; sourceId: string; trust: SourceTrust }
  const rawEvidence = validEvidence.find((item) => item.field === 'hours.raw')
  const rawSource = rawEvidence && sourcesById.get(rawEvidence.sourceId)
  const modelRaw = result.hours.raw?.trim() || null
  const modelDisplay = result.hours.display
  const rawMatchesSource = Boolean(modelRaw && !isUnavailableHours(modelRaw) && rawSource && normalizedText(textForModel(rawSource)).includes(normalizedText(modelRaw)))
  const hourCandidates: HourCandidate[] = [
    ...(rawMatchesSource && rawEvidence && rawSource
      ? [{ raw: modelRaw!, sourceId: rawSource.id, trust: rawSource.trust }]
      : []),
    ...result.hours.ranges.flatMap((range, index) => {
      const evidence = validEvidence.find((item) => item.field === `hours.ranges.${index}`)
      const source = evidence && sourcesById.get(evidence.sourceId)
      return source
        ? expandHourRanges([range]).map((slot) => ({ slot, sourceId: source.id, trust: source.trust }))
        : []
    }),
    ...(context.parsedHours ?? []).flatMap(({ raw, slots, sourceId, trust }) => [
      ...(raw ? [{ raw, sourceId, trust }] : []),
      ...slots.map((slot) => ({ slot, sourceId, trust })),
    ]),
  ]
  // Cualquier horario oficial domina el conjunto completo; no se completa con terceros.
  const selectedTrust: SourceTrust | null = hourCandidates.some((item) => item.trust === 'official')
    ? 'official'
    : hourCandidates.length > 0
      ? 'third_party'
      : null
  const seenHours = new Set<string>()
  const selectedSlots = hourCandidates
    .filter((item): item is HourCandidate & { slot: HoursSlot } => item.trust === selectedTrust && Boolean(item.slot))
    .flatMap((item) => {
      const key = `${item.slot.day}:${item.slot.opens}:${item.slot.closes ?? ''}`
      if (seenHours.has(key)) return []
      seenHours.add(key)
      return [item]
    })
    .sort((left, right) => left.slot.day - right.slot.day || left.slot.opens.localeCompare(right.slot.opens))
  const selectedSlotSources = new Set(selectedSlots.map((item) => item.sourceId))
  const rawCandidate = hourCandidates.find((item) => item.trust === selectedTrust && item.raw && selectedSlotSources.has(item.sourceId))
    ?? hourCandidates.find((item) => item.trust === selectedTrust && item.raw)
  const hoursUnavailable = isUnavailableHours(rawCandidate?.raw)
  const processed: ProcessedExtraction = {
    ...result,
    hours: hoursUnavailable
    ? { raw: null, display: null, slots: [] }
    : {
      raw: rawCandidate?.raw ?? null,
      display: null,
      slots: selectedSlots.map((item) => item.slot),
    },
  }
  for (const field of ['vegan', 'vegetarian', 'glutenFree'] as const) {
    const path = `dietary.${field}`
    if (processed.dietary[field] !== 'unknown') {
      if (!supported(path)) processed.dietary[field] = 'unknown'
    }
  }
  for (const field of ['price', 'reservations', 'outdoorSeating'] as const) {
    if (processed[field] !== 'unknown') {
      if (!supported(field)) processed[field] = 'unknown'
    }
  }
  // Un precio por persona publicado en las fuentes tiene precedencia sobre la
  // clasificación del modelo, incluso cuando el modelo no lo haya citado.
  processed.price = deterministicPrice(sources) ?? processed.price
  for (const field of ['phone', 'whatsapp', 'instagram', 'website', 'menuUrl', 'reservationUrl'] as const) {
    const path = `contact.${field}`
    if (processed.contact[field]) {
      if (!supported(path)) processed.contact[field] = null
    }
  }

  processed.contact = normalizeContact(processed.contact)
  if (context.deterministicContact) {
    processed.contact = normalizeContact({ ...processed.contact, ...context.deterministicContact })
  }
  if (processed.contact.reservationUrl && (processed.reservations === 'unknown' || processed.reservations === 'no_reservations')) {
    processed.reservations = 'accepts'
  }

  applyConsistencyRules(processed, sources)
  if (processed.categories.length === 0) {
    processed.categories = (context.categoryFallback ?? []).filter((id): id is keyof typeof CATEGORIES => id in CATEGORIES)
  }

  const normalizedHours = {
    ...processed.hours,
    display: (rawCandidate && rawCandidate.raw === modelRaw && rawCandidate.sourceId === rawSource?.id
      ? modelDisplay
      : null) ?? displayFromSlots(processed.hours.slots),
    status: processed.hours.slots.length > 0
      ? processed.hours.slots.every((slot) => slot.closes !== null) ? 'exact' as const : 'partial' as const
      : processed.hours.raw ? 'vague' as const : 'none' as const,
    source: hoursUnavailable ? null : selectedTrust,
  }

  const tags = [...processed.categories, ...processed.moments, ...processed.cuisines, ...processed.foods, ...processed.drinks, ...processed.features, ...processed.goodFor,
    ...(processed.dietary.vegan === 'has_options' || processed.dietary.vegan === 'fully' ? ['vegan'] : []),
    ...(processed.dietary.vegetarian === 'has_options' || processed.dietary.vegetarian === 'fully' ? ['vegetarian'] : []),
    ...(processed.dietary.glutenFree === 'has_options' || processed.dietary.glutenFree === 'fully' ? ['gluten_free'] : [])]
  const searchInput = {
    name: target.name,
    neighborhood: neighborhoodDisplayName(target.neighborhoodId) ?? 'Montevideo',
    description: processed.description,
    tags: [...new Set(tags)],
    highlights: processed.highlights,
  }
  return PlaceDraft.parse({
    ...target,
    ...processed,
    hours: normalizedHours,
    embeddingText: buildEmbeddingText(searchInput),
    keywordText: buildKeywordText(searchInput),
  })
}

function apiFailure(error: unknown): PlacesProviderError {
  if (error instanceof PlacesProviderError) return error
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401 || error.statusCode === 403) return new PlacesProviderError('authorization', 'Vercel AI Gateway rechazó la clave configurada.', { cause: error })
    if (error.statusCode === 429) return new PlacesProviderError('quota', 'Vercel AI Gateway limitó temporalmente las consultas.', { cause: error })
    if (error.statusCode === 408 || error.statusCode === 504) return new PlacesProviderError('timeout', 'Vercel AI Gateway demoró demasiado en responder.', { cause: error })
  }
  return new PlacesProviderError('upstream', 'No se pudo extraer la información del lugar.', { cause: error })
}

function instagramAudit(
  candidates: string[],
  validation: InstagramValidation,
  contactHandle: string | null = null,
  data?: PlaceExtraction,
  sources: Source[] = [],
) {
  const selectedSource = data?.evidence.find((item) => item.field === 'contact.instagram')
  const source = selectedSource && sources.find((item) => item.id === selectedSource.sourceId)
  const origin = validation.profile && contactHandle === instagramHandle(validation.profile.url)
    ? 'official_profile' as const
    : source?.kind === 'exa' && source.url === 'https://exa.ai/'
      ? 'exa_summary' as const
      : source?.kind === 'exa'
        ? 'exa_result' as const
        : source
          ? 'llm_evidence' as const
          : null
  return {
    google: true,
    exa: sources.some((item) => item.kind === 'exa'),
    instagram: Boolean(validation.profile),
    instagramCandidates: candidates.map((url) => instagramHandle(url)).filter((handle): handle is string => Boolean(handle)),
    instagramSelection: {
      handle: contactHandle,
      origin,
      candidates: validation.candidates,
    },
  }
}

function roundUsd(value: number): number {
  return Math.round(value * 100_000_000) / 100_000_000
}

function extractionCost(
  rates: ExtractionCostRates,
  usage: ExtractionCostUsage,
  inputTokens: number | null,
  outputTokens: number | null,
): PlaceExtractionCost {
  const googleCost = usage.googleRequests * rates.googleDetailsRequestUsd
  const exaCost = usage.exaRequests * rates.exaSearchRequestUsd + usage.exaContentPages * rates.exaContentPageUsd
  const instagramCost = usage.instagramRequests * rates.instagramRunUsd
  const scrapingCost = usage.scrapingRequests * rates.scrapingRequestUsd
  const transitCost = usage.transitRequests * rates.transitRequestUsd
  const inputCost = (inputTokens ?? 0) * rates.llmInputTokenUsd
  const outputCost = (outputTokens ?? 0) * rates.llmOutputTokenUsd
  const llmCost = inputCost + outputCost

  return {
    currency: 'USD',
    estimated: true,
    totalUsd: roundUsd(googleCost + exaCost + instagramCost + scrapingCost + transitCost + llmCost),
    providers: {
      google: { requests: usage.googleRequests, costUsd: roundUsd(googleCost) },
      exa: { requests: usage.exaRequests, contentPages: usage.exaContentPages, costUsd: roundUsd(exaCost) },
      instagram: { requests: usage.instagramRequests, costUsd: roundUsd(instagramCost) },
      scraping: { requests: usage.scrapingRequests, costUsd: roundUsd(scrapingCost) },
      transit: { requests: usage.transitRequests, costUsd: roundUsd(transitCost) },
      llm: {
        inputTokens,
        outputTokens,
        inputCostUsd: roundUsd(inputCost),
        outputCostUsd: roundUsd(outputCost),
        costUsd: roundUsd(llmCost),
      },
    },
  }
}

function extractionPerformance(
  startedAt: number,
  timings: Record<string, number>,
  sourceText: SourceTextStats,
  inputTokens: number | null,
  outputTokens: number | null,
  cost: PlaceExtractionCost,
): PlaceExtractionPerformance {
  return {
    totalMs: Math.round(performance.now() - startedAt),
    stepsMs: timings,
    sourceText,
    inputTokens,
    outputTokens,
    costUsd: cost,
  }
}

export class PlaceExtractionService implements PlaceExtractor {
  readonly configured: boolean
  private readonly details: DetailsProvider
  private readonly exa?: ExaPlaceProvider
  private readonly instagram?: InstagramProvider
  private readonly website?: WebsiteProvider
  private readonly transit?: TransitProvider
  private readonly generate: GenerateExtraction
  private readonly costRates: ExtractionCostRates
  private readonly reservationHosts: readonly string[]
  private readonly cache = new Map<string, Promise<PlaceEnrichmentResponse>>()

  constructor(config: { apiKey?: string; details: DetailsProvider; exa?: ExaPlaceProvider; instagram?: InstagramProvider; website?: WebsiteProvider; transit?: TransitProvider; generate?: GenerateExtraction; costRates?: Partial<ExtractionCostRates>; reservationHosts?: readonly string[] }) {
    this.configured = Boolean(config.apiKey?.trim())
    this.details = config.details
    this.exa = config.exa
    this.instagram = config.instagram
    this.website = config.website
    this.transit = config.transit
    this.generate = config.generate ?? generatePlaceExtraction
    this.costRates = extractionCostRates(config.costRates)
    this.reservationHosts = config.reservationHosts ?? DEFAULT_RESERVATION_HOSTS
  }

  async extract(placeId: string, request: { name: string; seedCategory: CategoryId; refresh?: boolean }): Promise<PlaceEnrichmentResponse> {
    if (!this.configured) throw new PlacesProviderError('configuration', 'Falta configurar AI_GATEWAY_API_KEY en .env.local.')
    const cacheKey = `${placeId}:${canonical(request.name).replace(/\s+/g, ' ').trim()}:${request.seedCategory}`
    if (request.refresh) this.cache.delete(cacheKey)
    const cached = this.cache.get(cacheKey)
    if (cached) return cached
    const pending = this.run(placeId, request).catch((error) => { this.cache.delete(cacheKey); throw error })
    this.cache.set(cacheKey, pending)
    if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value as string)
    return pending
  }

  private async run(placeId: string, request: { name: string; seedCategory: CategoryId; refresh?: boolean }): Promise<PlaceEnrichmentResponse> {
    const startedAt = performance.now()
    const timings: Record<string, number> = {}
    let sourceCount = 0
    let sourceCharacters = 0
    let sourceText: SourceTextStats = {
      beforeChars: 0, afterChars: 0, estimatedInputTokensBefore: 0, estimatedInputTokensAfter: 0, estimatedInputTokensSaved: 0,
    }
    const costUsage: ExtractionCostUsage = {
      googleRequests: 0,
      exaRequests: 0,
      exaContentPages: 0,
      instagramRequests: 0,
      scrapingRequests: 0,
      transitRequests: 0,
    }
    const timed = async <T>(stage: string, operation: () => Promise<T>): Promise<T> => {
      const stageStartedAt = performance.now()
      try {
        return await operation()
      } finally {
        timings[stage] = Math.round(performance.now() - stageStartedAt)
      }
    }
    try {
      const detailsPromise = timed('google', () => this.details.getDetails(placeId))
      const exaPromise = this.exa?.configured
        ? timed('exa', () => this.exa!.searchPlace(request.name, { refresh: request.refresh })).catch(() => null)
        : Promise.resolve(null)
      const transitPromise = timed('transit', () => detailsPromise
        .then((details) => this.transit
          ? this.transit.findNearbyLines(details.anchor.latitude, details.anchor.longitude).catch(() => ({ status: 'unavailable' as const, lines: [] }))
          : ({ status: 'unavailable' as const, lines: [] }))
        .catch(() => ({ status: 'unavailable' as const, lines: [] })))
      const details = await detailsPromise
      costUsage.googleRequests = 1
      if (!samePlaceName(request.name, details.anchor.name)) {
        throw new PlacesProviderError('validation', 'El nombre enviado no coincide con el lugar de Google Places.')
      }
      const coordinates = {
        lat: details.anchor.latitude,
        lng: details.anchor.longitude,
        source: 'google' as const,
        fetchedAt: new Date().toISOString(),
      }
      const neighborhood = getNeighborhood(coordinates.lat, coordinates.lng)
      const websitePromise = this.website?.configured && details.websiteUri && !instagramProfileUrl(details.websiteUri) &&
        !hostedBy(details.websiteUri, this.reservationHosts) && !isSocialUrl(details.websiteUri) &&
        !hostedBy(details.websiteUri, LINK_AGGREGATOR_HOSTS)
        ? timed('scraping', () => this.website!.scrape(details.websiteUri as string)).catch(() => null)
        : Promise.resolve(null)
      const exa = await exaPromise
      if (exa) {
        costUsage.exaRequests = 1
        costUsage.exaContentPages = exa.results.length
      }
      const candidates = instagramCandidates(details, exa)
      if (this.instagram?.configured && candidates.length > 0) costUsage.instagramRequests = 1
      const instagramValidation = await timed('instagram', () => validatedInstagram(this.instagram, details, candidates))
      const profile = instagramValidation.profile
      const website = await websitePromise
      if (website) costUsage.scrapingRequests = 1
      const exaCandidates = exa ? sourceFromExa(exa) : []
      const exaSummary = exa ? sourceFromExaSummary(exa) : null
      const instagramSource = profile ? sourceFromInstagram(profile) : null
      const blockedUrls = [...new Set(exaCandidates
        .filter((source) => source.kind === 'blocked' || isBlockedSource(source.url))
        .map((source) => source.url))]
      const blockedDomains = [...new Set(blockedUrls.map((url) => hostname(url)).filter(Boolean))]
      console.info(JSON.stringify({ event: 'place_extraction_sources', placeId, name: details.anchor.name, blockedSourceCount: blockedUrls.length, blockedDomains }))
      const staged = [
        ...(website ? filterSources([sourceFromWebsite(website)]).map((source) => ({ source, origin: 'website' as const })) : []),
        ...(instagramSource ? filterSources([instagramSource]).map((source) => ({ source, origin: 'instagram' as const })) : []),
        ...(exaSummary ? filterSources([exaSummary]).map((source) => ({ source, origin: 'exa' as const })) : []),
        ...filterSources(exaCandidates).map((source) => ({ source, origin: 'exa' as const })),
      ]
      const seenUrls = new Set<string>()
      const used = staged.filter(({ source }) => {
        // La misma URL puede llegar como resultado resumido de Exa y como
        // contenido scrapeado directamente: ambas señales tienen distinto origen.
        const key = `${source.kind}:${source.trust}:${normalizedUrl(source.url) ?? source.url}`
        if (seenUrls.has(key)) return false
        seenUrls.add(key)
        return true
      })
      const deduplicated = deduplicateSourceText(reindexSources(used.map(({ source }) => source)))
      const sources = deduplicated.sources
      const deterministicContact = resolveDeterministicContact(details, sources, this.reservationHosts)
      sourceText = deduplicated.stats
      sourceCount = sources.length
      sourceCharacters = sources.reduce((total, source) => total + source.text.slice(0, MAX_CHARS_PER_SOURCE).length, 0)
      const baseTarget = {
        name: details.anchor.name,
        address: details.anchor.address,
        coordinates,
        ...neighborhood,
        city: 'Montevideo' as const,
        googlePlaceId: placeId,
      }
      if (sources.length === 0) {
        const transit = await transitPromise
        if (this.transit) costUsage.transitRequests = 1
        const target: Target = { ...baseTarget, transit }
        return {
          source: 'openai', status: 'no_sources', model: MODEL,
          sourceAudit: instagramAudit(candidates, instagramValidation),
          performance: extractionPerformance(
            startedAt,
            timings,
            sourceText,
            null,
            null,
            extractionCost(this.costRates, costUsage, null, null),
          ),
          target,
        }
      }
      const promptTarget: Target = { ...baseTarget, transit: { status: 'unavailable', lines: [] } }
      const [generated, transit] = await Promise.all([timed('llm', () => this.generate(promptTarget, sources)), transitPromise])
      if (this.transit) costUsage.transitRequests = 1
      const { data, inputTokens, outputTokens } = generatedData(generated)
      const target: Target = { ...baseTarget, transit }
      const place = postProcess(target, data, {
        sources,
        seedCategory: request.seedCategory,
        parsedHours: parseExplicitHours(sources, { city: target.city, address: target.address }),
        deterministicContact,
        categoryFallback: [],
      })
      return {
        source: 'openai', status: 'ok', model: MODEL,
        sourceAudit: instagramAudit(candidates, instagramValidation, place.contact.instagram, data, sources),
        performance: extractionPerformance(
          startedAt,
          timings,
          sourceText,
          inputTokens,
          outputTokens,
          extractionCost(this.costRates, costUsage, inputTokens, outputTokens),
        ),
        place,
      }
    } catch (error) {
      throw apiFailure(error)
    } finally {
      console.info(JSON.stringify({
        event: 'place_extraction_timing',
        placeId,
        name: request.name,
        totalMs: Math.round(performance.now() - startedAt),
        timingsMs: timings,
        sourceCount,
        sourceCharacters,
      }))
    }
  }

}
