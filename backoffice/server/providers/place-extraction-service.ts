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
  OFFERS,
  type TagGroupName,
  type TagId,
  buildEmbeddingText,
  buildKeywordText,
  groupOf,
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
  PlaceReview,
  PlaceReviewAnomaly,
} from '../../src/types/places.ts'
import { PlacesProviderError } from './places-provider.ts'
import { withServiceLimit } from './service-limits.ts'
import type { TransitInfo } from './montevideo-bus-provider.ts'
import type { ExaPlaceProvider } from './exa-place-provider.ts'
import type { ApifyInstagramProvider, InstagramProfileData } from './apify-instagram-provider.ts'
import type { PlaywrightWebsiteScraper, WebsitePageData } from './website-scraper.ts'

const DEFAULT_EXTRACTION_MODEL = 'anthropic/claude-sonnet-5.5'
const MAX_CHARS_PER_SOURCE = 6_000
const MAX_FACTS = 40
const MAX_HIGHLIGHTS = 8
const BLOCKED_HOSTS = ['google.com', 'goo.gl', 'maps.app.goo.gl', 'corner.inc', 'exa.ai', 'facebook.com', 'foursquare.com']
const DIRECTORY_HOSTS = ['opina.com.uy', 'linkedin.com', 'tripadvisor', 'restaurantguru', 'yelp.com', 'wanderlog.com', 'saliracomer.com', 'laguiadelociouruguay.com']

export type SourceKind = 'web' | 'instagram' | 'reservations' | 'directory' | 'exa'
export type SourceTrust = 'official' | 'third_party'
type HoursSlot = { day: number; opens: string; closes: string | null }
export type Source = {
  id: string
  kind: SourceKind
  trust: SourceTrust
  url: string
  text: string
  links?: string[]
}
type SourceCandidate = Omit<Source, 'kind' | 'trust'> & { kind: SourceKind | 'blocked'; trust?: SourceTrust }
type SourceContext = { name: string; websiteUrl?: string | null; instagramUrls?: string[] }
type Target = Omit<PlaceEnrichmentDraft, 'categories' | 'tags' | 'dietary' | 'price' | 'reservations' | 'hours' | 'contact' | 'highlights' | 'description' | 'locatedIn' | 'placeFacts' | 'embeddingText' | 'keywordText'>

const DietLevel = z.enum(['unknown', 'no', 'has_options', 'fully'])
const FactKind = z.enum(['food', 'drink', 'feature', 'hours', 'dietary', 'price', 'reservations', 'contact', 'other'])

const TagGroupField = z.enum(['categories', 'moments', 'cuisines', 'foods', 'drinks', 'features', 'goodFor', 'offers'])

// Una sola lista de { group, id, facts }: cada categoría o tag cita los facts que lo respaldan.
// Sin enums de ids, .max() ni regex: con la salida estructurada nativa, ocho listas o cientos
// de enums hacen la gramática demasiado grande, y un valor fuera de rango tiraría abajo todo
// el llamado. Los ids, topes y formatos se validan en postProcess.
export const PlaceExtraction = z.object({
  // Cada fact tiene un id (F1, F2…) y todas las citas usan ese id, no la posición.
  facts: z.array(z.object({ id: z.string(), text: z.string(), sourceId: z.string(), kind: FactKind, proposedTag: z.string().nullable() })),
  tags: z.array(z.object({ group: TagGroupField, id: z.string(), facts: z.array(z.string()) })),
  dietary: z.object({ vegan: DietLevel, vegetarian: DietLevel, glutenFree: DietLevel }),
  price: z.enum(['unknown', 'low', 'moderate', 'high', 'very_high']),
  reservations: z.enum(['unknown', 'no_reservations', 'accepts', 'recommended']),
  hours: z.object({
    raw: z.string().nullable(),
    display: z.object({ es: z.string(), en: z.string() }).nullable(),
    blocks: z.array(z.object({
      days: z.array(z.number().int()),
      opens: z.string(),
      closes: z.string().nullable(),
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
  highlights: z.array(z.object({ es: z.string(), en: z.string(), facts: z.array(z.string()) })),
  description: z.object({ es: z.string(), en: z.string() }),
  // Lugar que contiene al local; sus facts van en support con field locatedIn. Un string y no un
  // objeto: el objeto nullable agranda la gramática del output estructurado y Anthropic la rechaza.
  locatedIn: z.string().nullable(),
  // Respaldo de los campos que no son tags: dietary, price, reservations, hours y contact.
  support: z.array(z.object({ field: z.string(), facts: z.array(z.string()) })),
  // Lo que el modelo no supo encasillar; el tope se aplica en reviewExtraction.
  doubts: z.array(z.string()),
})

export type PlaceExtraction = z.infer<typeof PlaceExtraction>

// Segunda búsqueda de horarios (cadenas): sólo hours, con los mismos blocks.
export const HoursRetryExtraction = z.object({
  facts: z.array(z.object({ id: z.string(), text: z.string(), sourceId: z.string() })),
  raw: z.string().nullable(),
  blocks: z.array(z.object({
    days: z.array(z.number().int()),
    opens: z.string(),
    closes: z.string().nullable(),
  })),
  otherBranchHours: z.boolean(),
})

export type HoursRetryExtraction = z.infer<typeof HoursRetryExtraction>

export const HOURS_RETRY_PROMPT = `Buscás el horario de UNA sucursal en Montevideo. Devolvé sólo horarios.
- Solo usá horarios que correspondan a la sucursal de esta dirección. Si la fuente lista varias sucursales, elegí la que coincide con la dirección. Si no podés confirmar la sucursal, devolvé vacío.
- facts: los hechos de horario que usaste, cada uno con id (H1, H2…), text (una frase corta en español) y sourceId (el id de la fuente).
- raw: el texto del horario tal como aparece en la fuente, o null.
- blocks: lista de { days, opens, closes }: days son los días (0 = domingo … 6 = sábado); opens y closes en HH:MM; closes null si no hay hora de cierre. Dos turnos el mismo día son dos bloques. Si cierra después de medianoche, closes es la hora del día siguiente. Nunca estimes ni inventes horas.
- otherBranchHours: true si las fuentes traen horarios de otras sucursales de la marca que no son la de esta dirección; si no, false.
- Vacío es facts [], raw null y blocks [].`

export type PlaceExtractor = {
  readonly configured: boolean
  extract(placeId: string, request: PlaceExtractionRequest): Promise<PlaceEnrichmentResponse>
}

export type PlaceExtractionRequest = {
  seedCategories: CategoryId[]
  /** Si no llega, se calcula con las coordenadas de Google. */
  neighborhoodId?: string
}

export type ExtractionReasoning = 'low' | 'medium' | 'high'
export type ExtractionModelConfig = { model: string; reasoning: ExtractionReasoning }

export function extractionModelConfig(env: Record<string, string | undefined> = process.env): ExtractionModelConfig {
  const reasoning = env.EXTRACTION_REASONING?.trim()
  return {
    model: env.EXTRACTION_MODEL?.trim() || DEFAULT_EXTRACTION_MODEL,
    reasoning: reasoning === 'low' || reasoning === 'high' ? reasoning : 'medium',
  }
}

export const DEFAULT_HOURS_MODEL = 'openai/gpt-5-mini'

/** Modelo de la segunda búsqueda de horarios: una tarea corta, con un modelo más barato. */
export function hoursModelConfig(env: Record<string, string | undefined> = process.env): ExtractionModelConfig {
  return { model: env.HOURS_MODEL?.trim() || DEFAULT_HOURS_MODEL, reasoning: 'low' }
}

// Cada proveedor del gateway nombra distinto el esfuerzo de razonamiento.
export function providerOptionsFor(config: ExtractionModelConfig): Record<string, Record<string, string>> {
  const provider = config.model.split('/')[0]
  if (provider === 'openai') return { openai: { reasoningEffort: config.reasoning } }
  // outputFormat: salida estructurada nativa. Sin ella, el gateway cae a una tool no forzada
  // y el modelo puede devolver enums con comillas de más, que Zod rechaza.
  if (provider === 'anthropic') return { anthropic: { effort: config.reasoning, structuredOutputMode: 'outputFormat' } }
  return {}
}

type DetailsProvider = { getDetails(placeId: string): Promise<GooglePlaceDetailsResponse> }
type InstagramProvider = Pick<ApifyInstagramProvider, 'configured' | 'scrapeMany'>
type WebsiteProvider = Pick<PlaywrightWebsiteScraper, 'configured' | 'scrape'>
type TransitProvider = { findNearbyLines(latitude: number, longitude: number): Promise<TransitInfo> }
export type LlmUsage = {
  inputTokens: number | null
  /** Tokens de entrada leídos del cache. */
  cachedInputTokens: number | null
  /** Tokens de entrada escritos en el cache (Anthropic los cobra 1,25× la entrada). */
  cacheWriteTokens?: number | null
  outputTokens: number | null
  gatewayCostUsd: number | null
}
type GeneratedExtraction = { data: PlaceExtraction } & Partial<LlmUsage>
type GenerateExtraction = (target: Target, sources: Source[], config: ExtractionModelConfig) => Promise<PlaceExtraction | GeneratedExtraction>
type GeneratedHours = { data: HoursRetryExtraction } & Partial<LlmUsage>
type GenerateHours = (target: Target, sources: Source[], config: ExtractionModelConfig) => Promise<HoursRetryExtraction | GeneratedHours>

type ExtractionCostRates = {
  googleDetailsRequestUsd: number
  exaSearchRequestUsd: number
  exaContentPageUsd: number
  exaHighlightPageUsd: number
  instagramRunUsd: number
  scrapingRequestUsd: number
  transitRequestUsd: number
}

type ExtractionCostUsage = {
  googleRequests: number
  exaRequests: number
  exaContentPages: number
  exaHighlightPages: number
  instagramRequests: number
  scrapingRequests: number
  transitRequests: number
}

const DEFAULT_COST_RATES: ExtractionCostRates = {
  // Precios de lista por evento: Google Place Details Enterprise + Atmosphere
  // y Exa Search con contenido + highlights.
  googleDetailsRequestUsd: 0.025,
  exaSearchRequestUsd: 0.007,
  exaContentPageUsd: 0.002,
  // Sólo highlights, sin texto completo: la segunda búsqueda de horarios.
  exaHighlightPageUsd: 0.001,
  instagramRunUsd: 0,
  scrapingRequestUsd: 0,
  transitRequestUsd: 0,
}

// USD por millón de tokens, según el endpoint de modelos del AI Gateway.
// cacheWrite: OpenAI no cobra la escritura del cache; Anthropic la cobra 1,25× la entrada.
type LlmPrice = { input: number; cachedInput: number; cacheWrite: number; output: number }
export const LLM_PRICES_PER_MILLION: Record<string, LlmPrice> = {
  'openai/gpt-5-mini': { input: 0.25, cachedInput: 0.025, cacheWrite: 0.25, output: 2 },
  'anthropic/claude-sonnet-5.5': { input: 2, cachedInput: 0.1, cacheWrite: 2.5, output: 10 },
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
    exaHighlightPageUsd: configuredCostRate('EXTRACTION_COST_EXA_HIGHLIGHT_PAGE_USD', overrides.exaHighlightPageUsd ?? DEFAULT_COST_RATES.exaHighlightPageUsd),
    instagramRunUsd: configuredCostRate('EXTRACTION_COST_INSTAGRAM_RUN_USD', overrides.instagramRunUsd ?? DEFAULT_COST_RATES.instagramRunUsd),
    scrapingRequestUsd: configuredCostRate('EXTRACTION_COST_SCRAPING_REQUEST_USD', overrides.scrapingRequestUsd ?? DEFAULT_COST_RATES.scrapingRequestUsd),
    transitRequestUsd: configuredCostRate('EXTRACTION_COST_TRANSIT_REQUEST_USD', overrides.transitRequestUsd ?? DEFAULT_COST_RATES.transitRequestUsd),
  }
}

// Las variables EXTRACTION_COST_LLM_* siguen pisando el precio de la tabla.
function llmPrice(model: string): LlmPrice | null {
  const known = LLM_PRICES_PER_MILLION[model]
  const input = Number(process.env.EXTRACTION_COST_LLM_INPUT_TOKEN_USD)
  const output = Number(process.env.EXTRACTION_COST_LLM_OUTPUT_TOKEN_USD)
  if (Number.isFinite(input) && input >= 0 && Number.isFinite(output) && output >= 0 && process.env.EXTRACTION_COST_LLM_INPUT_TOKEN_USD && process.env.EXTRACTION_COST_LLM_OUTPUT_TOKEN_USD) {
    return { input: input * 1_000_000, cachedInput: known?.cachedInput ?? input * 1_000_000, cacheWrite: known?.cacheWrite ?? input * 1_000_000, output: output * 1_000_000 }
  }
  return known ?? null
}

const ALLOWED_TAG_GROUPS = { categories: CATEGORIES, moments: MOMENTS, cuisines: CUISINES, foods: FOODS, drinks: DRINKS, features: FEATURES, goodFor: GOOD_FOR, offers: OFFERS } as const

export const SYSTEM_PROMPT = `Sos un curador de gastronomía de Montevideo. A partir de las fuentes, devolvé un JSON sobre el local objetivo. Trabajá en dos pasos y en este orden.

PASO 1 — facts
- facts es la lista de hechos concretos que dicen las fuentes sobre el local objetivo. Cada fact tiene id (F1, F2, F3… en orden, sin repetir), text (una frase corta en español), sourceId (el id de la fuente de donde sale) y kind: food, drink, feature, hours, dietary, price, reservations, contact u other.
- Máximo 40 facts, de una frase corta cada uno. Priorizá los que sirven para tags, horarios, dietary y la descripción.
- Sólo hechos del local objetivo: ignorá otras sucursales, otras ciudades y otros países, aunque compartan nombre o cuenta (por ejemplo, un Instagram de otro país).
- Ignorá el contenido de tienda online: productos envasados, bolsas de café, suscripciones, insumos, merch, gift cards y sus precios. Ignorá también reseñas y puntajes.
- Las etiquetas sueltas de un directorio ("Tags: Brunch", "Categories: X") no son hechos.
- Nada inventado ni deducido sin base. Cada fuente indica si es OFICIAL (web o Instagram validado del local) o TERCEROS; si se contradicen, gana la OFICIAL.

PASO 2 — el resto del JSON, sólo a partir de facts
- tags es una lista de { group, id, facts } con las categorías y los tags del local: group es categories, moments, cuisines, foods, drinks, features, goodFor u offers; id es uno de los ids permitidos de ese grupo (ver IDS PERMITIDOS); facts son los ids de los facts que lo respaldan (por ejemplo ["F3", "F7"]).
- support respalda los demás datos: una entrada { field, facts }, con los ids de los facts, para cada uno que completes, con field exactamente igual a uno de estos: dietary.vegan, dietary.vegetarian, dietary.glutenFree, price, reservations, hours, contact.phone, contact.whatsapp, contact.instagram, contact.website, contact.menuUrl, contact.reservationUrl, locatedIn.
- Lo que no cite un fact se descarta.
- proposedTag: en cada fact que no cites en ningún tag ni support, completá proposedTag: el id existente que debería haberse usado, un id nuevo en snake_case si ningún tag encaja, o null. proposedTag es null solo para anécdotas, historia de la marca, datos de contacto, medios de pago o información de otras sucursales. Si el fact describe comida, bebida, actividades o características del lugar, proponé un tag existente o uno nuevo. En los facts citados, null.
- Platos y bebidas concretos nunca van con proposedTag null: mapealos al tag más cercano (tapas o platos pequeños → tapas, y además picada si mencionan tablas, fiambres o quesos para compartir; postres dulces → desserts; jugos o licuados → smoothies; yogur, tostadas o similares → breakfast).
- Cada tag tiene que corresponder a al menos un fact. No pongas tags sin un fact que los respalde. Usá solamente los ids permitidos.
- Inferí tags razonables a partir de los facts. Ejemplo inventado: "pasan música con DJs los viernes y se llena a la salida de la oficina" → dj, after_office; "ideal para trabajar con la compu" → work. Pero foods, cuisines y dietary sólo con menciones explícitas: nunca deduzcas platos, tipo de cocina ni opciones dietarias por el tipo de local. cuisines tiene máximo tres valores.
- Los facts de fuentes de terceros son válidos para tags de comida, bebida, características y momentos. Solo dietary necesita una mención explícita, y si una fuente oficial contradice a un tercero, gana la oficial.
- Platos concretos siempre se mapean a un tag: cortes de carne o achuras → grilled_meat; pescados, mariscos o arroces con mariscos → seafood; pastas rellenas o caseras → pasta; flan, panqueques u otros postres → desserts; falafel, hummus o similares → middle_eastern; bowls o ensaladas → salads; huevos o tostadas → breakfast. Variedad de cervezas → craft_beer o draft_beer. Transmisiones deportivas → el tag de pantallas para fútbol (watch_football).
- Si hay facts de bebidas, tiene que haber al menos un tag de bebida. Una mención genérica de tragos o cócteles → classic_cocktails. Tragos propios de la casa, de autor, o cócteles con una base especial (ej. a base de vino) → signature_cocktails.
- moments: no devuelvas late_night; lo decide el código con los horarios.
- features: open_kitchen sólo si se menciona una cocina a la vista o abierta; bar_seating sólo si se puede comer en la barra, no por tener una barra para pedir bebidas. delivery y takeaway sólo para comida del local, nunca envíos de una tienda online.
- Distinguí espacios al aire libre: patio = espacio interno o trasero; terrace = terraza o azotea elevada; sidewalk = mesas en la vereda. No los uses como sinónimos.
- Usá patio, terrace o sidewalk solo si la fuente dice explícitamente patio, terraza/azotea o vereda. Si solo dice al aire libre o mesas afuera sin detalle, usá outdoor.
- Sesiones de discos o escucha de vinilos → vinyl.
- Si una fuente dice que solo se paga en efectivo, usá cash_only.
- Jams, toques o bandas → live_music además de events. Libros o actividades para chicos → kids_friendly.
- Sillas altas, menú infantil, juegos o espacio para chicos → kids_friendly.
- offers: sólo promociones o formatos concretos (merienda para dos, menú del día o ejecutivo, tenedor libre, happy hour).
- dietary no se infiere: has_options si un fact menciona opciones veganas, vegetarianas o sin TACC; fully sólo con una frase inequívoca de que todo el local cumple; "no" sólo si se dice explícitamente; si no, unknown. Si el menú menciona queso, huevo, manteca, leche o crema que no sean veganos, vegan no puede ser fully.
- Una versión vegetal explícita de un plato (de soja, de seitán, veggie, de lentejas) cuenta como vegetarian has_options.
- price sólo con precios o una mención explícita. reservations sólo con un fact que lo diga.
- contact.website es exclusivamente la web propia del local. Los links de reservas, delivery, WhatsApp o Linktree van a su campo, nunca a website.
- Si las fuentes dicen que el local está dentro de otro lugar (shopping, mercado, galería, hotel, museo, polo gastronómico), completá locatedIn con el nombre de ese lugar. Si no lo dicen claramente, null. No lo deduzcas solo de la dirección.
- Si completás locatedIn, citá en support los facts que lo dicen, con field locatedIn.

HORARIOS
- Si hay un horario en una fuente OFICIAL, usá sólo ese para raw y blocks: no lo completes ni lo mezcles con horarios de TERCEROS (por ejemplo, no tomes una hora de cierre de un directorio).
- Si el horario aparece en una sola fuente de terceros y ninguna otra lo contradice, usalo (source third_party).
- Si las fuentes de horarios se contradicen: gana la oficial; si la web oficial y el Instagram oficial difieren, gana Instagram. Si no hay oficial, gana el horario en el que coinciden más fuentes; si hay empate, gana el que trae días y horas de cierre completos. Dejá los horarios vacíos si no podés aplicar ninguno de estos criterios.
- Cuando apliques un desempate, anotá en doubts cuál criterio usaste (por ejemplo: «Horario: ganó Instagram oficial sobre la web»).
- hours.raw conserva el texto del horario de una sola fuente, tal como aparece, sin reinterpretarlo; null si no hay o si la fuente dice que no está disponible.
- hours.blocks es una lista de { days, opens, closes }: days son los días a los que aplica el bloque (0 = domingo … 6 = sábado); opens y closes van en HH:MM.
- Interpretá cualquier formato de horario en español o inglés (rangos, abreviaturas de una letra, "a partir de", "todos los días", tablas, varios turnos). Si no hay hora de cierre, closes es null. Nunca estimes ni inventes horas que no estén en las fuentes.
- Dos turnos el mismo día son dos bloques. Si cierra después de medianoche, closes es la hora del día siguiente (por ejemplo 01:00). Un día cerrado no lleva bloque.
- Si la fuente usa "typically", "generally", "usually", "approximately", "aproximadamente", "suele" o "en general", no cargues bloques.
- hours.display sólo hace falta si hay raw pero no podés armar bloques: no agregues ningún dato que no esté en raw.

HIGHLIGHTS Y DESCRIPCIÓN
- highlights son platos o tragos concretos y cortos que aparecen en los facts; nunca productos de tienda online. Cada uno es { es, en, facts }: facts son los ids de los facts donde aparece; es siempre en español aunque la fuente esté en otro idioma (usá el nombre conocido en español si existe); en siempre en inglés. Para nombres locales sin traducción, conservá el nombre y, si hace falta, agregá sólo en en una aclaración breve entre paréntesis.
- description.es: 2-3 frases en rioplatense, cercanas y sin exagerar, con palabras propias: qué es, qué se come y toma, el ambiente y el mejor momento. Sin horarios y sin mencionar empresas ni terceros irrelevantes. description.en: la misma idea en inglés natural.
- La descripción sólo puede mencionar cosas que estén en facts, y todo lo que mencione tiene que estar en los tags: si decís DJ → dj; tragos o cócteles → classic_cocktails o signature_cocktails; after office → after_office; celebraciones → celebration; patio → patio. No menciones nada que no hayas tagueado.
- doubts: anotá en doubts lo que no supiste resolver (máx. 5). No inventes dudas.

IDS PERMITIDOS
${(Object.entries(ALLOWED_TAG_GROUPS) as [string, Record<string, unknown>][]).map(([group, definitions]) => `- ${group}: ${Object.keys(definitions).join(', ')}`).join('\n')}`

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

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/

// Acepta "9:00" y "24:00", que el modelo a veces devuelve, y descarta el resto de los formatos.
function normalizedTime(value: string | null): string | null {
  const match = value?.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const time = `${match[1].padStart(2, '0')}:${match[2]}`
  if (time === '24:00') return '00:00'
  return HH_MM.test(time) ? time : null
}

type HoursBlock = PlaceExtraction['hours']['blocks'][number]

/** Valida los bloques del modelo y los convierte en un slot por día por bloque. Un bloque inválido se descarta entero. */
export function slotsFromBlocks(blocks: HoursBlock[]): HoursSlot[] {
  const seen = new Set<string>()
  const slots: HoursSlot[] = []
  for (const block of blocks) {
    const opens = normalizedTime(block.opens)
    const closes = block.closes === null ? null : normalizedTime(block.closes)
    const validDays = block.days.length > 0 && block.days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    if (!opens || (block.closes !== null && !closes) || !validDays) continue
    for (const day of block.days) {
      const key = `${day}:${opens}:${closes ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      slots.push({ day, opens, closes })
    }
  }
  return slots.sort((left, right) => left.day - right.day || left.opens.localeCompare(right.opens))
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
    .map((group) => {
      const days = displayDayRange(group.days, language)
      // Sin hora de cierre: "Todos los días desde las 18:00" / "Every day from 18:00".
      if (group.slots.length === 1 && group.slots[0].closes === null) {
        return language === 'es' ? `${days} desde las ${group.slots[0].opens}` : `${days} from ${group.slots[0].opens}`
      }
      return `${days}: ${displayPeriods(group.slots, language)}`
    })
    .join('; ')
  return { es: format('es'), en: format('en') }
}

function sourceFromExa(exa: Pick<ExaPlaceResponse, 'results'>): SourceCandidate[] {
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
    profiles = await withServiceLimit('apify', () => provider.scrapeMany(candidates))
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

/**
 * Request del llamado principal. El prompt de sistema es igual para todos los lugares: se marca
 * para el cache de Anthropic (OpenAI cachea solo el prefijo y ignora la opción).
 */
export function mainExtractionRequest(target: Target, sources: Source[], config: ExtractionModelConfig) {
  return {
    model: config.model,
    output: Output.object({ schema: PlaceExtraction }),
    system: {
      role: 'system' as const,
      content: SYSTEM_PROMPT,
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    },
    prompt: prompt(target, sources),
    providerOptions: providerOptionsFor(config),
  }
}

type UsageResult = { usage?: { inputTokens?: number; outputTokens?: number; inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number } }; providerMetadata?: Record<string, unknown> }

function usageFrom(result: UsageResult): LlmUsage {
  const gatewayCost = Number((result.providerMetadata?.gateway as { cost?: unknown } | undefined)?.cost)
  return {
    inputTokens: result.usage?.inputTokens ?? null,
    cachedInputTokens: result.usage?.inputTokenDetails?.cacheReadTokens ?? null,
    cacheWriteTokens: result.usage?.inputTokenDetails?.cacheWriteTokens ?? null,
    outputTokens: result.usage?.outputTokens ?? null,
    gatewayCostUsd: Number.isFinite(gatewayCost) ? gatewayCost : null,
  }
}

async function generatePlaceExtraction(target: Target, sources: Source[], config: ExtractionModelConfig): Promise<GeneratedExtraction> {
  const result = await generateText(mainExtractionRequest(target, sources, config))
  return { data: result.output, ...usageFrom(result) }
}

async function generateHoursRetry(target: Target, sources: Source[], config: ExtractionModelConfig): Promise<GeneratedHours> {
  const sourceBlocks = sources.map((source) => `<source id="${source.id}" url="${source.url}">\n${source.text.slice(0, MAX_CHARS_PER_SOURCE)}\n</source>`).join('\n\n')
  const result = await generateText({
    model: config.model,
    output: Output.object({ schema: HoursRetryExtraction }),
    system: HOURS_RETRY_PROMPT,
    prompt: `LOCAL OBJETIVO\nNombre: ${target.name}\nDirección: ${target.address}\n\nFUENTES\n${sourceBlocks}`,
    providerOptions: providerOptionsFor(config),
  })
  return { data: result.output, ...usageFrom(result) }
}

function generatedData(value: PlaceExtraction | GeneratedExtraction): { data: PlaceExtraction } & LlmUsage {
  const generated = 'data' in value ? value : { data: value }
  return {
    data: generated.data,
    inputTokens: generated.inputTokens ?? null,
    cachedInputTokens: generated.cachedInputTokens ?? null,
    cacheWriteTokens: generated.cacheWriteTokens ?? null,
    outputTokens: generated.outputTokens ?? null,
    gatewayCostUsd: generated.gatewayCostUsd ?? null,
  }
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

// El esquema del LLM pide los grupos por separado; el post-proceso los une en tags.
const LLM_TAG_GROUPS = ['moments', 'cuisines', 'foods', 'drinks', 'features', 'goodFor', 'offers'] as const satisfies readonly TagGroupName[]
// El código los calcula desde los horarios: un proposedTag no los aplica.
const HOURS_DERIVED_TAGS = new Set(['late_night', 'breakfast', 'lunch', 'dinner'])
const MAX_CUISINES = 3

type ProcessedExtraction = Omit<PlaceExtraction, 'hours' | 'facts' | 'support' | 'tags' | 'highlights' | 'doubts' | 'locatedIn'> & {
  locatedIn: string | null
  highlights: { es: string; en: string }[]
  categories: CategoryId[]
  tags: TagId[]
  hours: { raw: string | null; display: { es: string; en: string } | null; slots: HoursSlot[] }
}

function tagsOfGroup(tags: TagId[], group: TagGroupName) {
  return tags.filter((id) => groupOf(id) === group)
}

function capCuisines(tags: TagId[]) {
  const keep = new Set(tagsOfGroup(tags, 'cuisines').slice(0, MAX_CUISINES))
  return tags.filter((id) => groupOf(id) !== 'cuisines' || keep.has(id))
}

function applyRestaurantCategoryImplication(result: Pick<ProcessedExtraction, 'categories'>) {
  if (result.categories.some((category) => category === 'grill' || category === 'pizzeria' || category === 'chiviteria')) {
    addUnique(result.categories, 'restaurant')
  }
}

function appendCategoryFoodsAndCuisines(result: Pick<ProcessedExtraction, 'categories' | 'tags'>) {
  if (result.categories.includes('grill')) {
    addUnique(result.tags, 'grilled_meat')
    addUnique(result.tags, 'uruguayan')
  }
  if (result.categories.includes('pizzeria')) addUnique(result.tags, 'pizza')
  if (result.categories.includes('chiviteria')) addUnique(result.tags, 'chivito')
  if (result.categories.includes('ice_cream_shop')) addUnique(result.tags, 'ice_cream')
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

// Coherencia dietaria: no depende de palabras, sólo de los niveles ya validados.
function applyDietaryCoherence(result: Pick<ProcessedExtraction, 'dietary' | 'tags'>) {
  if (result.dietary.vegan === 'fully') result.dietary.vegetarian = 'fully'
  if (result.dietary.vegan === 'fully' || result.dietary.vegetarian === 'fully') {
    result.tags = result.tags.filter((tag) => tag !== 'grilled_meat')
  }
}

// Reglas que no dependen de palabras: categorías, horarios y dietary.
function applyConsistencyRules(result: ProcessedExtraction) {
  // restaurant debe estar presente antes de las reglas de moments que dependen de ella.
  applyRestaurantCategoryImplication(result)
  appendCategoryFoodsAndCuisines(result)
  if (result.categories.includes('wine_bar')) {
    addUnique(result.tags, 'wine')
    addUnique(result.tags, 'drinks')
  }
  if (result.categories.some((category) => category === 'bar' || category === 'brewery')) addUnique(result.tags, 'drinks')
  applyDietaryCoherence(result)

  const slots = result.hours.slots
  if (result.categories.some((category) => category === 'cafe' || category === 'bakery')) {
    addUnique(result.tags, 'breakfast')
    addUnique(result.tags, 'afternoon_snack')
  }
  const isRestaurant = result.categories.includes('restaurant')
  if (isRestaurant && slots.some((entry) => minutes(entry.opens) < 10 * 60)) addUnique(result.tags, 'breakfast')
  const hasMealFood = tagsOfGroup(result.tags, 'foods').some((food) => food !== 'picada' && food !== 'desserts')
  if (hasMealFood && slots.some((entry) => minutes(entry.opens) <= 13 * 60)) addUnique(result.tags, 'lunch')
  if (hasMealFood && isOpenAt(slots, 21 * 60)) addUnique(result.tags, 'dinner')
  if (isRestaurant && (slots.some((entry) => minutes(entry.opens) < 13 * 60) || isOpenAt(slots, 13 * 60 + 30))) addUnique(result.tags, 'lunch')
  if (isRestaurant && isOpenAt(slots, 21 * 60 + 30)) addUnique(result.tags, 'dinner')
  if (slots.some((entry) => {
    if (!entry.closes) return false
    const closes = minutes(entry.closes)
    return closes >= 2 * 60 && closes <= 6 * 60
  })) addUnique(result.tags, 'late_night')
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

type ValidFact = { id: string; text: string; kind: PlaceExtraction['facts'][number]['kind']; source: Source }

// El modelo a veces cita "hours.blocks.0" o "hours.raw": todo eso respalda hours.
function canonicalSupportField(field: string) {
  const trimmed = field.trim()
  return trimmed === 'hours' || trimmed.startsWith('hours.') ? 'hours' : trimmed
}

type TaggedItem = PlaceExtraction['tags'][number]

export function postProcess(
  target: Target,
  data: PlaceExtraction,
  context: { sources?: Source[]; seedCategories?: CategoryId[]; categoryFallback?: string[]; deterministicContact?: DeterministicContact } = {},
): PlaceEnrichmentDraft {
  const sources = context.sources ?? []
  const sourcesById = new Map(sources.map((source) => [source.id, source]))
  const result = structuredClone(data)

  // Facts: id sin repetir, fuente existente y texto, hasta MAX_FACTS.
  const seenFactIds = new Set<string>()
  const facts: ValidFact[] = result.facts.slice(0, MAX_FACTS).flatMap((fact) => {
    const id = fact.id.trim()
    const source = sourcesById.get(fact.sourceId)
    if (!id || seenFactIds.has(id) || !source || !fact.text.trim()) return []
    seenFactIds.add(id)
    return [{ id, text: fact.text.trim(), kind: fact.kind, source }]
  })
  const factsById = new Map(facts.map((fact) => [fact.id, fact]))
  const validCitations = (ids: string[]) => [...new Set(ids.map((id) => id.trim()).filter((id) => factsById.has(id)))]

  const movedReservation = Boolean(result.contact.website && hostedBy(result.contact.website, DEFAULT_RESERVATION_HOSTS) && !result.contact.reservationUrl)
  const movedWhatsapp = Boolean(result.contact.website && /^https?:\/\/(?:wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\//i.test(result.contact.website) && !result.contact.whatsapp)
  result.contact = classifyContact(result.contact)
  // Support: cada campo queda con los facts válidos que lo respaldan.
  const support = new Map<string, string[]>()
  for (const item of result.support) {
    const canonicalField = canonicalSupportField(item.field)
    const field = movedReservation && canonicalField === 'contact.website'
      ? 'contact.reservationUrl'
      : movedWhatsapp && canonicalField === 'contact.website'
        ? 'contact.whatsapp'
        : canonicalField
    const cited = validCitations(item.facts)
    if (cited.length > 0) support.set(field, [...new Set([...(support.get(field) ?? []), ...cited])])
  }
  // Un proposedTag que ya existe en tags.ts se aplica citando su fact: si el tag ya está, el fact
  // se suma a sus citas; si no, se agrega. Nunca dietary ni los momentos que salen de los horarios.
  for (const fact of facts) {
    const id = result.facts.find((item) => item.id.trim() === fact.id)?.proposedTag?.trim()
    const group = id ? groupOf(id) : null
    if (!id || !group || HOURS_DERIVED_TAGS.has(id)) continue
    if (group !== 'categories' && !(LLM_TAG_GROUPS as readonly string[]).includes(group)) continue
    const existing = result.tags.find((item) => item.group === group && item.id === id)
    if (existing) {
      if (!existing.facts.includes(fact.id)) existing.facts.push(fact.id)
    } else {
      result.tags.push({ group: group as TaggedItem['group'], id, facts: [fact.id] })
    }
  }
  // Cada tag trae sus propios facts: se registran como support de `${grupo}.${id}`.
  // Object.hasOwn y no `in`: un id como "constructor" no puede pasar por tag.
  const knownTag = (item: TaggedItem) => Object.hasOwn(ALLOWED_TAG_GROUPS, item.group) && Object.hasOwn(ALLOWED_TAG_GROUPS[item.group], item.id)
  for (const item of result.tags) {
    const cited = validCitations(item.facts)
    const field = `${item.group}.${item.id}`
    if (cited.length > 0 && knownTag(item)) support.set(field, [...new Set([...(support.get(field) ?? []), ...cited])])
  }
  const verifiedFields = new Set<string>()
  const supported = (field: string) => support.has(field) || verifiedFields.has(field)

  const trustedInstagram = sources.filter((source) => source.kind === 'instagram' && source.trust === 'official')
  if (trustedInstagram.length === 1) {
    const handle = instagramProfileUrl(trustedInstagram[0].url)?.split('/').filter(Boolean).at(-1) ?? null
    if (handle) {
      result.contact.instagram = handle
      verifiedFields.add('contact.instagram')
    }
  }

  // La semilla siempre queda; las categorías del modelo necesitan un fact.
  // Sólo ids conocidos del grupo y con al menos un fact válido.
  const retainTags = <T extends string>(group: keyof typeof ALLOWED_TAG_GROUPS): T[] =>
    [...new Set(result.tags.filter((item) => item.group === group && knownTag(item) && supported(`${group}.${item.id}`)).map((item) => item.id))] as T[]
  const categories = retainTags<CategoryId>('categories')
  for (const seedCategory of context.seedCategories ?? []) addUnique(categories, seedCategory)
  const tags: TagId[] = [...new Set<TagId>([
    // late_night jamás se toma del modelo: depende exclusivamente de los horarios.
    ...retainTags<TagId>('moments').filter((moment) => moment !== 'late_night'),
    ...LLM_TAG_GROUPS.filter((group) => group !== 'moments').flatMap((group) => retainTags<TagId>(group)),
  ])]
  // Un highlight tiene que citar un fact válido y aparecer en alguna fuente, en español o en inglés.
  const highlights = result.highlights
    .filter((highlight) => validCitations(highlight.facts).length > 0 &&
      sources.some((source) => hasPhrase(source.text, highlight.es) || hasPhrase(source.text, highlight.en)))
    .map(({ es, en }) => ({ es, en }))
    .slice(0, MAX_HIGHLIGHTS)

  // Horarios: el modelo interpreta, el código valida bloques y decide la confianza por la fuente del fact.
  const hoursFacts = (support.get('hours') ?? []).map((id) => factsById.get(id)!).filter(Boolean)
  const slots = hoursFacts.length > 0 ? slotsFromBlocks(result.hours.blocks) : []
  const raw = hoursFacts.length > 0 ? result.hours.raw?.trim() || null : null
  const hoursSource: SourceTrust | null = slots.length > 0 || raw
    ? hoursFacts.some((fact) => fact.source.trust === 'official') ? 'official' : 'third_party'
    : null

  const processed: ProcessedExtraction = {
    categories,
    tags,
    dietary: result.dietary,
    price: result.price,
    reservations: result.reservations,
    hours: { raw, display: null, slots },
    contact: result.contact,
    highlights,
    description: result.description,
    // Sólo con un fact en support: ese support también saca sus facts de los unmapped.
    locatedIn: supported('locatedIn') ? result.locatedIn?.trim() || null : null,
  }
  for (const field of ['vegan', 'vegetarian', 'glutenFree'] as const) {
    if (processed.dietary[field] !== 'unknown' && !supported(`dietary.${field}`)) processed.dietary[field] = 'unknown'
  }
  for (const field of ['price', 'reservations'] as const) {
    if (processed[field] !== 'unknown' && !supported(field)) processed[field] = 'unknown'
  }
  // Un precio por persona publicado en las fuentes tiene precedencia sobre la
  // clasificación del modelo, incluso cuando el modelo no lo haya citado.
  processed.price = deterministicPrice(sources) ?? processed.price
  for (const field of ['phone', 'whatsapp', 'instagram', 'website', 'menuUrl', 'reservationUrl'] as const) {
    if (processed.contact[field] && !supported(`contact.${field}`)) processed.contact[field] = null
  }

  processed.contact = normalizeContact(processed.contact)
  if (context.deterministicContact) {
    processed.contact = normalizeContact({ ...processed.contact, ...context.deterministicContact })
  }
  if (processed.contact.reservationUrl && (processed.reservations === 'unknown' || processed.reservations === 'no_reservations')) {
    processed.reservations = 'accepts'
  }

  applyConsistencyRules(processed)
  processed.tags = capCuisines(processed.tags)
  if (processed.categories.length === 0) {
    processed.categories = (context.categoryFallback ?? []).filter((id): id is keyof typeof CATEGORIES => id in CATEGORIES)
  }

  const normalizedHours = {
    raw: processed.hours.raw,
    slots: processed.hours.slots,
    // Con slots, display siempre sale del código. Sólo un horario vague (raw sin slots) usa el display del modelo.
    display: slots.length > 0 ? displayFromSlots(slots) : raw ? result.hours.display : null,
    status: slots.length > 0
      ? slots.every((slot) => slot.closes !== null) ? 'exact' as const : 'partial' as const
      : raw ? 'vague' as const : 'none' as const,
    source: hoursSource,
    // Sin slots, la UI muestra el horario de Google en vivo. extractFrom lo afina tras la segunda búsqueda.
    missingReason: slots.length > 0 ? null : 'no_data' as const,
  }

  const supportsByFact = new Map<string, string[]>()
  for (const [field, ids] of support) {
    for (const id of ids) supportsByFact.set(id, [...(supportsByFact.get(id) ?? []), field])
  }
  const placeFacts = facts.map((fact) => ({
    id: fact.id,
    text: fact.text,
    kind: fact.kind,
    sourceId: fact.source.id,
    sourceUrl: fact.source.url,
    trust: fact.source.trust,
    supports: supportsByFact.get(fact.id) ?? [],
  }))

  // Los facts no entran en el texto de búsqueda: sólo nombre, barrio, descripción, tags y highlights.
  const searchTags = [...processed.categories, ...processed.tags,
    ...(processed.dietary.vegan === 'has_options' || processed.dietary.vegan === 'fully' ? ['vegan'] : []),
    ...(processed.dietary.vegetarian === 'has_options' || processed.dietary.vegetarian === 'fully' ? ['vegetarian'] : []),
    ...(processed.dietary.glutenFree === 'has_options' || processed.dietary.glutenFree === 'fully' ? ['gluten_free'] : [])]
  const searchInput = {
    name: target.name,
    neighborhood: neighborhoodDisplayName(target.neighborhoodId) ?? 'Montevideo',
    description: processed.description,
    locatedIn: processed.locatedIn,
    tags: [...new Set(searchTags)],
    highlights: processed.highlights,
  }
  return PlaceDraft.parse({
    ...target,
    ...processed,
    hours: normalizedHours,
    placeFacts,
    embeddingText: buildEmbeddingText(searchInput),
    keywordText: buildKeywordText(searchInput),
  })
}

/**
 * Suma el horario de la segunda búsqueda a la extracción: facts H al principio (no los corta
 * MAX_FACTS), hours reemplazado y support de hours sólo con esos facts. postProcess valida todo.
 */
export function withRecoveredHours(data: PlaceExtraction, retry: HoursRetryExtraction, sources: Source[]): PlaceExtraction {
  const sourceIds = new Set(sources.map((source) => source.id))
  const facts = retry.facts
    .filter((fact) => sourceIds.has(fact.sourceId) && fact.text.trim())
    .map((fact, index) => ({ id: `H${index + 1}`, text: fact.text, sourceId: fact.sourceId, kind: 'hours' as const, proposedTag: null }))
  return {
    ...data,
    facts: [...facts, ...data.facts],
    hours: { raw: retry.raw, display: null, blocks: facts.length > 0 ? retry.blocks : [] },
    support: [
      ...data.support.filter((item) => canonicalSupportField(item.field) !== 'hours'),
      ...(facts.length > 0 ? [{ field: 'hours', facts: facts.map((fact) => fact.id) }] : []),
    ],
  }
}

/**
 * La fuente nombra la sucursal: aparece el número de puerta de la dirección o, si no tiene
 * número, todas las palabras de la calle.
 */
export function mentionsAddress(text: string, address: string): boolean {
  const street = canonical(address.split(',')[0] ?? '')
  const haystack = ` ${canonical(text).replace(/[^a-z0-9]+/g, ' ')} `
  const number = street.match(/\b\d{2,5}\b/)?.[0]
  if (number) return haystack.includes(` ${number} `)
  const words = street.split(/[^a-z0-9]+/).filter((word) => word.length >= 4)
  return words.length > 0 && words.every((word) => haystack.includes(` ${word} `))
}

const MAX_DOUBTS = 5
const DAY_LABELS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

/**
 * Lo que el pipeline no resolvió en un lugar, para el reporte del lote. No modifica el borrador.
 * Un fact queda sin mapear si ningún tag, campo, horario ni highlight conservado lo cita.
 */
export function reviewExtraction(
  place: PlaceEnrichmentDraft,
  data: PlaceExtraction,
  hoursRetry: PlaceReview['hoursRetry'] = { attempted: false, recovered: false, costUsd: 0 },
): PlaceReview {
  const keptHighlights = new Set(place.highlights.map((highlight) => highlight.es))
  const citedByHighlights = new Set(data.highlights
    .filter((highlight) => keptHighlights.has(highlight.es))
    .flatMap((highlight) => highlight.facts.map((id) => id.trim())))
  const proposedTags = new Map(data.facts.map((fact) => [fact.id.trim(), proposedTagFrom(fact.proposedTag)]))
  const unmappedFacts = place.placeFacts
    .filter((fact) => fact.supports.length === 0 && !citedByHighlights.has(fact.id))
    .map(({ id, text }) => ({ id, text, proposedTag: proposedTags.get(id) ?? null }))

  const doubts = [...new Set(data.doubts.map((doubt) => doubt.trim()).filter(Boolean))].slice(0, MAX_DOUBTS)

  const anomalies: PlaceReviewAnomaly[] = []
  const { hours, categories, tags, dietary, contact } = place
  if (hours.status === 'vague' || hours.status === 'none') {
    anomalies.push({ type: 'hours_vague', detail: hours.raw ? `${hours.status}: ${hours.raw}` : hours.status })
  }
  const openEnded = hours.slots.filter((slot) => slot.closes === null)
  if (openEnded.length > 0) {
    anomalies.push({ type: 'hours_no_close', detail: openEnded.map((slot) => `${DAY_LABELS[slot.day]} desde ${slot.opens}`).join(', ') })
  }
  const barCategory = categories.find((category) => category === 'bar' || category === 'brewery' || category === 'wine_bar')
  if (barCategory && !tags.some((tag) => groupOf(tag) === 'drinks')) {
    anomalies.push({ type: 'bar_without_drinks', detail: barCategory })
  }
  if (categories.includes('restaurant') && !tags.some((tag) => groupOf(tag) === 'foods')) {
    anomalies.push({ type: 'restaurant_without_food', detail: 'restaurant' })
  }
  const fully = (['vegan', 'vegetarian', 'glutenFree'] as const).filter((field) => dietary[field] === 'fully')
  if (fully.length > 0) anomalies.push({ type: 'dietary_fully', detail: fully.join(', ') })
  if (!contact.instagram && !contact.website) anomalies.push({ type: 'no_contact', detail: 'sin instagram ni website' })

  return { unmappedFacts, doubts, anomalies, hoursRetry }
}

// Un id existente de tags.ts o uno nuevo en snake_case; cualquier otra cosa cuenta como null.
function proposedTagFrom(value: string | null | undefined): string | null {
  const id = value?.trim() ?? ''
  return /^[a-z][a-z0-9_]{2,39}$/.test(id) ? id : null
}

// Resumen del error y de sus causas para la consola: nombre, status, mensaje y el cuerpo de la
// respuesta recortado. Nunca el request, que lleva el prompt con las fuentes.
function errorChain(error: unknown) {
  const chain: { name: string; statusCode?: number; type?: string; message: string; responseBody?: string }[] = []
  let current: unknown = error
  while (current instanceof Error && chain.length < 4) {
    const details = current as Error & { statusCode?: unknown; type?: unknown; responseBody?: unknown }
    chain.push({
      name: details.name,
      ...(typeof details.statusCode === 'number' ? { statusCode: details.statusCode } : {}),
      ...(typeof details.type === 'string' ? { type: details.type } : {}),
      message: details.message.slice(0, 500),
      ...(typeof details.responseBody === 'string' ? { responseBody: details.responseBody.slice(0, 500) } : {}),
    })
    current = details.cause
  }
  return chain
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
  placeFacts: PlaceEnrichmentDraft['placeFacts'] = [],
  sources: Source[] = [],
) {
  const selectedFact = placeFacts.find((fact) => fact.supports.includes('contact.instagram'))
  const source = selectedFact && sources.find((item) => item.id === selectedFact.sourceId)
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
  model: string,
  llm: LlmUsage | null,
  hoursRetry: { model: string; usage: LlmUsage } | null = null,
): PlaceExtractionCost {
  const googleCost = usage.googleRequests * rates.googleDetailsRequestUsd
  const exaCost = usage.exaRequests * rates.exaSearchRequestUsd + usage.exaContentPages * rates.exaContentPageUsd +
    usage.exaHighlightPages * rates.exaHighlightPageUsd
  const instagramCost = usage.instagramRequests * rates.instagramRunUsd
  const scrapingCost = usage.scrapingRequests * rates.scrapingRequestUsd
  const transitCost = usage.transitRequests * rates.transitRequestUsd
  const price = llm ? llmPrice(model) : null
  const { inputCost, outputCost } = llmUsageCost(model, llm)
  const llmCost = inputCost + outputCost
  const hoursRetryCost = hoursRetry ? llmUsageCost(hoursRetry.model, hoursRetry.usage) : null
  const hoursRetryUsd = hoursRetryCost ? hoursRetryCost.inputCost + hoursRetryCost.outputCost : 0

  return {
    currency: 'USD',
    // Las tarifas de Google y Exa son de lista; el LLM es real si hay precio y uso.
    estimated: !(price && llm?.inputTokens !== null && llm?.outputTokens !== null),
    totalUsd: roundUsd(googleCost + exaCost + instagramCost + scrapingCost + transitCost + llmCost + hoursRetryUsd),
    providers: {
      google: { requests: usage.googleRequests, costUsd: roundUsd(googleCost) },
      exa: { requests: usage.exaRequests, contentPages: usage.exaContentPages, highlightPages: usage.exaHighlightPages, costUsd: roundUsd(exaCost) },
      instagram: { requests: usage.instagramRequests, costUsd: roundUsd(instagramCost) },
      scraping: { requests: usage.scrapingRequests, costUsd: roundUsd(scrapingCost) },
      transit: { requests: usage.transitRequests, costUsd: roundUsd(transitCost) },
      llm: {
        model,
        inputTokens: llm?.inputTokens ?? null,
        cachedInputTokens: llm?.cachedInputTokens ?? null,
        cacheWriteTokens: llm?.cacheWriteTokens ?? null,
        outputTokens: llm?.outputTokens ?? null,
        gatewayCostUsd: llm?.gatewayCostUsd ?? null,
        inputCostUsd: roundUsd(inputCost),
        outputCostUsd: roundUsd(outputCost),
        costUsd: roundUsd(llmCost),
      },
      ...(hoursRetry ? {
        hoursRetry: {
          model: hoursRetry.model,
          inputTokens: hoursRetry.usage.inputTokens,
          outputTokens: hoursRetry.usage.outputTokens,
          costUsd: roundUsd(hoursRetryUsd),
        },
      } : {}),
    },
  }
}

// Costo real: tokens que devuelve el AI SDK por el precio conocido del modelo. inputTokens
// incluye lo leído y lo escrito en cache: cada parte se cobra a su precio.
export function llmUsageCost(model: string, llm: LlmUsage | null) {
  const price = llm ? llmPrice(model) : null
  const cacheRead = llm?.cachedInputTokens ?? 0
  const cacheWrite = llm?.cacheWriteTokens ?? 0
  const inputCost = price && llm
    ? (Math.max(0, (llm.inputTokens ?? 0) - cacheRead - cacheWrite) * price.input + cacheRead * price.cachedInput + cacheWrite * price.cacheWrite) / 1_000_000
    : 0
  const outputCost = price && llm ? (llm.outputTokens ?? 0) * price.output / 1_000_000 : 0
  return { inputCost, outputCost }
}

function extractionPerformance(
  totalMs: number,
  timings: Record<string, number>,
  sourceText: SourceTextStats,
  llm: LlmUsage | null,
  cost: PlaceExtractionCost,
): PlaceExtractionPerformance {
  return {
    totalMs: Math.round(totalMs),
    stepsMs: timings,
    sourceText,
    inputTokens: llm?.inputTokens ?? null,
    outputTokens: llm?.outputTokens ?? null,
    costUsd: cost,
  }
}

/** Fuentes ya buscadas de un lugar. Se pueden pasar varias veces a extractFrom con distintos modelos. */
export type CollectedSources = {
  placeId: string
  request: PlaceExtractionRequest
  target: Target
  sources: Source[]
  sourceText: SourceTextStats
  deterministicContact: DeterministicContact
  instagramCandidates: string[]
  instagramValidation: InstagramValidation
  costUsage: ExtractionCostUsage
  timings: Record<string, number>
  elapsedMs: number
}

export class PlaceExtractionService implements PlaceExtractor {
  readonly configured: boolean
  private readonly details: DetailsProvider
  private readonly exa?: ExaPlaceProvider
  private readonly instagram?: InstagramProvider
  private readonly website?: WebsiteProvider
  private readonly transit?: TransitProvider
  private readonly generate: GenerateExtraction
  private readonly generateHours: GenerateHours
  private readonly costRates: ExtractionCostRates
  private readonly reservationHosts: readonly string[]
  private readonly modelConfig: ExtractionModelConfig
  private readonly hoursModel: ExtractionModelConfig

  constructor(config: { apiKey?: string; details: DetailsProvider; exa?: ExaPlaceProvider; instagram?: InstagramProvider; website?: WebsiteProvider; transit?: TransitProvider; generate?: GenerateExtraction; generateHours?: GenerateHours; costRates?: Partial<ExtractionCostRates>; reservationHosts?: readonly string[]; model?: ExtractionModelConfig; hoursModel?: ExtractionModelConfig }) {
    this.configured = Boolean(config.apiKey?.trim())
    this.details = config.details
    this.exa = config.exa
    this.instagram = config.instagram
    this.website = config.website
    this.transit = config.transit
    this.generate = config.generate ?? generatePlaceExtraction
    this.generateHours = config.generateHours ?? generateHoursRetry
    this.costRates = extractionCostRates(config.costRates)
    this.reservationHosts = config.reservationHosts ?? DEFAULT_RESERVATION_HOSTS
    this.modelConfig = config.model ?? extractionModelConfig()
    this.hoursModel = config.hoursModel ?? hoursModelConfig()
  }

  // Sin cache ni estado: cada llamada corre el pipeline completo.
  async extract(placeId: string, request: PlaceExtractionRequest): Promise<PlaceEnrichmentResponse> {
    if (!this.configured) throw new PlacesProviderError('configuration', 'Falta configurar AI_GATEWAY_API_KEY en .env.local.')
    return this.extractFrom(await this.collectSources(placeId, request))
  }

  /** Google, Exa, scraping, Instagram y buses: todo lo que no es el LLM. */
  async collectSources(placeId: string, request: PlaceExtractionRequest): Promise<CollectedSources> {
    const startedAt = performance.now()
    const timings: Record<string, number> = {}
    let sourceCount = 0
    let sourceCharacters = 0
    const costUsage: ExtractionCostUsage = {
      googleRequests: 0,
      exaRequests: 0,
      exaContentPages: 0,
      exaHighlightPages: 0,
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
      // El request no trae nombre: Exa busca con el nombre que devuelve Google.
      const exaPromise = this.exa?.configured
        ? detailsPromise
          .then((details) => timed('exa', () => withServiceLimit('exa', () => this.exa!.searchPlace(details.anchor.name))))
          .catch(() => null)
        : Promise.resolve(null)
      const transitPromise = timed('transit', () => detailsPromise
        .then((details) => this.transit
          ? this.transit.findNearbyLines(details.anchor.latitude, details.anchor.longitude).catch(() => ({ status: 'unavailable' as const, lines: [] }))
          : ({ status: 'unavailable' as const, lines: [] }))
        .catch(() => ({ status: 'unavailable' as const, lines: [] })))
      const details = await detailsPromise
      costUsage.googleRequests = 1
      const coordinates = {
        lat: details.anchor.latitude,
        lng: details.anchor.longitude,
        source: 'google' as const,
        fetchedAt: new Date().toISOString(),
      }
      const neighborhood = request.neighborhoodId
        ? { neighborhoodId: request.neighborhoodId }
        : getNeighborhood(coordinates.lat, coordinates.lng)
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
      sourceCount = sources.length
      sourceCharacters = sources.reduce((total, source) => total + source.text.slice(0, MAX_CHARS_PER_SOURCE).length, 0)
      const transit = await transitPromise
      if (this.transit) costUsage.transitRequests = 1
      return {
        placeId,
        request,
        target: {
          name: details.anchor.name,
          address: details.anchor.address,
          coordinates,
          ...neighborhood,
          city: 'Montevideo' as const,
          googlePlaceId: placeId,
          transit,
        },
        sources,
        sourceText: deduplicated.stats,
        deterministicContact: resolveDeterministicContact(details, sources, this.reservationHosts),
        instagramCandidates: candidates,
        instagramValidation,
        costUsage,
        timings,
        elapsedMs: performance.now() - startedAt,
      }
    } catch (error) {
      console.error(JSON.stringify({ event: 'place_extraction_error', stage: 'sources', placeId, error: errorChain(error) }))
      throw apiFailure(error)
    } finally {
      console.info(JSON.stringify({
        event: 'place_extraction_sources_timing',
        placeId,
        totalMs: Math.round(performance.now() - startedAt),
        timingsMs: timings,
        sourceCount,
        sourceCharacters,
      }))
    }
  }

  /**
   * Una búsqueda de Exa dirigida a la sucursal (sólo highlights) y un llamado corto, con el
   * modelo de HOURS_MODEL, que devuelve sólo hours. El modelo ve sólo las fuentes nuevas,
   * numeradas a continuación de las del lugar.
   */
  private async retryHours(target: Target, sources: Source[], timings: Record<string, number>) {
    const startedAt = performance.now()
    const query = `${target.name} ${target.address} horario`
    const results = [await withServiceLimit('exa', () => this.exa!.searchText!(query)).catch(() => null)]
    const exaRequests = results.filter(Boolean).length
    const exaHighlightPages = results.reduce((total, result) => total + (result?.results.length ?? 0), 0)
    const seenUrls = new Set(sources.map((source) => normalizedUrl(source.url) ?? source.url))
    const newSources = filterSources(results.flatMap((result) => result ? sourceFromExa(result) : []))
      .filter((source) => {
        const key = normalizedUrl(source.url) ?? source.url
        if (seenUrls.has(key)) return false
        seenUrls.add(key)
        return true
      })
      .map((source, index) => ({ ...source, id: `S${sources.length + index + 1}` }))
    let usage: LlmUsage | null = null
    let extraction: HoursRetryExtraction | null = null
    if (newSources.length > 0) {
      const generated = await withServiceLimit('llm', () => this.generateHours(target, newSources, this.hoursModel))
      const value = 'data' in generated ? generated : { data: generated }
      extraction = value.data
      usage = {
        inputTokens: value.inputTokens ?? null,
        cachedInputTokens: value.cachedInputTokens ?? null,
        cacheWriteTokens: value.cacheWriteTokens ?? null,
        outputTokens: value.outputTokens ?? null,
        gatewayCostUsd: value.gatewayCostUsd ?? null,
      }
    }
    timings.hoursRetry = Math.round(performance.now() - startedAt)
    return { exaRequests, exaHighlightPages, sources: newSources, extraction, usage }
  }

  /** LLM + post-proceso sobre fuentes ya buscadas. No vuelve a consultar Google, Exa ni Instagram. */
  async extractFrom(collected: CollectedSources, config: ExtractionModelConfig = this.modelConfig): Promise<PlaceEnrichmentResponse> {
    const startedAt = performance.now()
    const timings = { ...collected.timings }
    const { target, sources } = collected
    try {
      if (sources.length === 0) {
        return {
          source: 'llm', status: 'no_sources', model: config.model,
          sourceAudit: instagramAudit(collected.instagramCandidates, collected.instagramValidation),
          performance: extractionPerformance(
            collected.elapsedMs, timings, collected.sourceText, null,
            extractionCost(this.costRates, collected.costUsage, config.model, null),
          ),
          target,
        }
      }
      // El modelo no necesita las líneas de buses para extraer.
      const promptTarget: Target = { ...target, transit: { status: 'unavailable', lines: [] } }
      // El tiempo del LLM no incluye la espera en la cola de concurrencia.
      const generated = await withServiceLimit('llm', async () => {
        const llmStartedAt = performance.now()
        try {
          return await this.generate(promptTarget, sources, config)
        } finally {
          timings.llm = Math.round(performance.now() - llmStartedAt)
        }
      })
      const { data: extracted, ...usage } = generatedData(generated)
      const context = {
        seedCategories: collected.request.seedCategories,
        deterministicContact: collected.deterministicContact,
        categoryFallback: [],
      }
      let data = extracted
      let allSources = sources
      let place = postProcess(target, data, { ...context, sources })

      // Sin horario usable (típico de cadenas): segunda búsqueda dirigida a la sucursal.
      const costUsage = { ...collected.costUsage }
      let hoursRetryUsage: LlmUsage | null = null
      const hoursRetry = { attempted: false, recovered: false, costUsd: 0 }
      if (place.hours.slots.length === 0 && this.exa?.configured && this.exa.searchText) {
        const retry = await this.retryHours(promptTarget, sources, timings)
        hoursRetry.attempted = true
        costUsage.exaRequests += retry.exaRequests
        costUsage.exaHighlightPages += retry.exaHighlightPages
        hoursRetryUsage = retry.usage
        hoursRetry.costUsd = roundUsd(retry.exaRequests * this.costRates.exaSearchRequestUsd +
          retry.exaHighlightPages * this.costRates.exaHighlightPageUsd +
          (retry.usage ? Object.values(llmUsageCost(this.hoursModel.model, retry.usage)).reduce((sum, value) => sum + value, 0) : 0))
        // Sólo cuentan los facts cuya fuente menciona la dirección del local: el modelo barato
        // a veces toma el horario de otra sucursal aunque el prompt lo prohíba.
        const branchFacts = retry.extraction?.facts.filter((fact) => {
          const source = retry.sources.find((item) => item.id === fact.sourceId)
          return Boolean(source && mentionsAddress(source.text, target.address))
        }) ?? []
        if (retry.extraction && branchFacts.length > 0) {
          const merged = withRecoveredHours(data, { ...retry.extraction, facts: branchFacts }, retry.sources)
          const recoveredSources = [...sources, ...retry.sources]
          const recovered = postProcess(target, merged, { ...context, sources: recoveredSources })
          if (recovered.hours.slots.length > 0) {
            data = merged
            allSources = recoveredSources
            place = recovered
            hoursRetry.recovered = true
          }
        }
        if (!hoursRetry.recovered && retry.extraction?.otherBranchHours) {
          place = { ...place, hours: { ...place.hours, missingReason: 'chain_branch_not_found' } }
        }
      }
      return {
        source: 'llm', status: 'ok', model: config.model,
        review: reviewExtraction(place, data, hoursRetry),
        sourceAudit: instagramAudit(collected.instagramCandidates, collected.instagramValidation, place.contact.instagram, place.placeFacts, allSources),
        performance: extractionPerformance(
          collected.elapsedMs + (performance.now() - startedAt), timings, collected.sourceText, usage,
          extractionCost(this.costRates, costUsage, config.model, usage, hoursRetryUsage ? { model: this.hoursModel.model, usage: hoursRetryUsage } : null),
        ),
        place,
      }
    } catch (error) {
      console.error(JSON.stringify({ event: 'place_extraction_error', stage: 'llm', placeId: collected.placeId, model: config.model, error: errorChain(error) }))
      throw apiFailure(error)
    } finally {
      console.info(JSON.stringify({
        event: 'place_extraction_timing',
        placeId: collected.placeId,
        model: config.model,
        totalMs: Math.round(collected.elapsedMs + (performance.now() - startedAt)),
        timingsMs: timings,
        sourceCount: sources.length,
      }))
    }
  }
}
