import { APICallError, generateText, Output } from 'ai'
import { findPhoneNumbersInText, parsePhoneNumberFromString, type PhoneNumber } from 'libphonenumber-js/max'
import { z } from 'zod'
import {
  CATEGORIES,
  type CategoryId,
  ATMOSPHERE,
  CUISINES,
  DRINKS,
  FEATURES,
  FOODS,
  GOOD_FOR,
  MOMENTS,
  OFFERS,
  STYLES,
  type StyleId,
  type TagDef,
  type TagGroupName,
  type TagId,
  buildEmbeddingText,
  buildKeywordText,
  findDef,
  groupOf,
  isStyleId,
} from '../../src/data/tags.ts'
import { PlaceDraft } from '../../src/data/place-schema.ts'
import { ICON_CATEGORIES, ICON_CATEGORY_KEYS } from '../../src/data/icon-categories.ts'
import { getNeighborhood } from '../../src/lib/getNeighborhood.ts'
import { neighborhoodDisplayName } from '../../src/data/neighborhood-names.ts'
import type {
  ExaPlaceResponse,
  ExaPlaceResult,
  GooglePlaceDetailsResponse,
  InstagramAuditCandidate,
  InstagramCandidateOrigin,
  InstagramMatchRule,
  InstagramTieBreakRule,
  LogoKind,
  PlaceEnrichmentDraft,
  PlaceEnrichmentResponse,
  PlaceExtractionCost,
  PlaceExtractionPerformance,
  PlaceReview,
  PlaceReviewAnomaly,
  TagEvidence,
} from '../../src/types/places.ts'
import { brandFromGoogleName, brandSearchTerm, googleNameParts, placeSearchTerm } from './brand-name.ts'
import {
  BLOCKED_HOSTS,
  DEFAULT_RESERVATION_HOSTS,
  DELIVERY_HOSTS,
  DIRECTORY_HOSTS,
  EXA_SUMMARY_URL,
  LINK_AGGREGATOR_HOSTS,
  canonical,
  hasPhrase,
  hostedBy,
  hostname,
  matchesPlaceDomain,
} from './source-hosts.ts'
import { ExaProviderFailure, InstagramProviderFailure, PlacesProviderError } from './places-provider.ts'
import { APIFY_TRANSIENT_DELAYS_MS, RateLimitLog, withRateLimitRetry, type RateLimitRetryOptions } from './rate-limit.ts'
import type { LimitedService } from './service-limits.ts'
import { withServiceLimit } from './service-limits.ts'
import type { TransitInfo } from './montevideo-bus-provider.ts'
import type { ExaPlaceProvider } from './exa-place-provider.ts'
import { INSTAGRAM_SEARCH_LIMIT, instagramSearchText, type ApifyInstagramProvider, type InstagramProfileData, type InstagramSearchResult } from './apify-instagram-provider.ts'
import type { PlaywrightWebsiteScraper, WebsitePageData } from './website-scraper.ts'
import { logoUrl, type LogoStore } from './logo-storage.ts'
import { isMomentId, MOMENT_IDS, MOMENT_SIGNALS, NOT_FOR_DEDUCTION, signalsIn, STYLE_SIGNALS, sufficientSignals, type SignalMatch } from './moment-signals.ts'
import type { ExtractionSnapshotStore } from './extraction-snapshots.ts'
import { classifyLogo, classifyProfilePicture, fetchPlaceLogo, logoModel, profilePictureStatus, type LogoClassifier, type LogoOutcome, type PictureClassification, type ProfilePictureStatus } from './place-logo.ts'
import { brandKey, InstagramCandidateRegistry, type InstagramOwners, type SharedInstagram } from './instagram-candidate-registry.ts'
import { instagramActivity, instagramOperating, reviewReasonsFor, type InstagramActivity } from './review-reasons.ts'

const DEFAULT_EXTRACTION_MODEL = 'anthropic/claude-sonnet-5.5'
const MAX_CHARS_PER_SOURCE = 6_000
const MAX_FACTS = 40
const MAX_HIGHLIGHTS = 8
const MAX_DISHES = 15
const MAX_SIGNATURE = 3
// Servicios y logística no definen a un lugar: nunca van en signature.
const SIGNATURE_EXCLUDED = new Set(['delivery', 'takeaway', 'wifi', 'outlets', 'accessible', 'pet_friendly', 'menu_of_the_day'])
// Momentos: sólo si el lugar se define por ese momento (un lugar de brunch).
const SIGNATURE_MOMENTS = new Set(['lunch', 'dinner', 'breakfast', 'brunch', 'afternoon_snack'])
export { DEFAULT_RESERVATION_HOSTS }

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
// Nombre y dirección de Google: sólo para buscar e identificar el local, nunca para guardar.
export type Target = Omit<PlaceEnrichmentDraft, 'name' | 'address' | 'categories' | 'tags' | 'dietary' | 'price' | 'reservations' | 'hours' | 'contact' | 'highlights' | 'description' | 'locatedIn' | 'placeFacts' | 'signals' | 'dishes' | 'signature' | 'embeddingText' | 'keywordText' | 'logo' | 'iconCategory' | 'style' | 'tagEvidence'> & { name: string; address: string }

/**
 * Local objetivo desde Place Details: nombre y dirección de Google (sólo para buscar e identificar, nunca se
 * guardan), coordenadas y barrio (el del request o el de las coordenadas).
 */
export function targetFromDetails(placeId: string, details: Pick<GooglePlaceDetailsResponse, 'anchor'>, request: Pick<PlaceExtractionRequest, 'neighborhoodId'>, transit: TransitInfo): Target {
  const coordinates = { lat: details.anchor.latitude, lng: details.anchor.longitude, source: 'google' as const, fetchedAt: new Date().toISOString() }
  return {
    name: details.anchor.name,
    address: details.anchor.address,
    coordinates,
    neighborhoodId: request.neighborhoodId ?? getNeighborhood(coordinates.lat, coordinates.lng).neighborhoodId,
    city: 'Montevideo' as const,
    googlePlaceId: placeId,
    transit,
  }
}

const DietLevel = z.enum(['unknown', 'no', 'has_options', 'fully'])
const FactKind = z.enum(['food', 'drink', 'feature', 'hours', 'dietary', 'price', 'reservations', 'contact', 'other'])

// style no es un tag: va en la misma lista (con sus facts) para no sumar un campo de primer nivel a la gramática.
const TagGroupField = z.enum(['categories', 'moments', 'cuisines', 'foods', 'drinks', 'features', 'atmosphere', 'goodFor', 'offers', 'style'])

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
  // "" = sin dato. Strings y no nullable para que entre la gramática; postProcess los pasa a null.
  contact: z.object({
    phone: z.string(),
    whatsapp: z.string(),
    instagram: z.string(),
    website: z.string(),
    menuUrl: z.string(),
    reservationUrl: z.string(),
  }),
  highlights: z.array(z.object({ es: z.string(), en: z.string(), facts: z.array(z.string()) })),
  // Platos y signature como strings simples: postProcess valida el respaldo, los ids y los topes.
  dishes: z.array(z.string()),
  signature: z.array(z.string()),
  description: z.object({ es: z.string(), en: z.string() }),
  // Nombre y dirección según las fuentes, con sus facts en support; "" si ninguna fuente los dice.
  // Strings simples y no nullable: cada nullable suma una rama a la gramática, que ya está al límite.
  name: z.string(),
  address: z.string(),
  // Lugar que contiene al local; sus facts van en support con field locatedIn. Un string y no un
  // objeto: el objeto nullable agranda la gramática del output estructurado y Anthropic la rechaza.
  locatedIn: z.string().nullable(),
  // Respaldo de los campos que no son tags: dietary, price, reservations, hours y contact.
  support: z.array(z.object({ field: z.string(), facts: z.array(z.string()) })),
  // Lo que el modelo no supo encasillar; el tope se aplica en reviewExtraction.
  doubts: z.array(z.string()),
  // Enum de claves sin descripciones: las descripciones van en el prompt, para no agrandar la gramática.
  iconCategory: z.enum(ICON_CATEGORY_KEYS),
})

export type PlaceExtraction = z.infer<typeof PlaceExtraction>
type Contact = PlaceEnrichmentDraft['contact']

/** El contacto del modelo usa "" para "sin dato"; el resto del pipeline usa null. */
function contactFromModel(contact: PlaceExtraction['contact']): Contact {
  const value = (text: string) => text.trim() || null
  return {
    phone: value(contact.phone),
    whatsapp: value(contact.whatsapp),
    instagram: value(contact.instagram),
    website: value(contact.website),
    menuUrl: value(contact.menuUrl),
    reservationUrl: value(contact.reservationUrl),
  }
}

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
type InstagramProvider = Pick<ApifyInstagramProvider, 'configured' | 'scrapeMany'> & Partial<Pick<ApifyInstagramProvider, 'searchProfiles'>>
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
  /** Búsqueda de usuarios de Instagram en Apify: se cobra por resultado. */
  instagramSearchResultUsd: number
  scrapingRequestUsd: number
  transitRequestUsd: number
}

type ExtractionCostUsage = {
  googleRequests: number
  exaRequests: number
  exaContentPages: number
  exaHighlightPages: number
  instagramRequests: number
  /** Resultados cobrados de la búsqueda de usuarios de Instagram (respaldo); falta en fuentes de antes. */
  instagramSearchResults?: number
  scrapingRequests: number
  transitRequests: number
}

const DEFAULT_COST_RATES: ExtractionCostRates = {
  // Precios de lista por evento: Google Place Details Enterprise + Atmosphere.
  googleDetailsRequestUsd: 0.025,
  // Exa cobra por búsqueda (costDollars de la API: US$0,007, con texto, highlights o salida estructurada
  // incluidos); no cobra aparte las páginas con contenido ni con highlights.
  exaSearchRequestUsd: 0.007,
  exaContentPageUsd: 0,
  exaHighlightPageUsd: 0,
  instagramRunUsd: 0,
  // apify~instagram-search-scraper, plan FREE (los planes pagos bajan el precio por resultado).
  instagramSearchResultUsd: 0.0027,
  scrapingRequestUsd: 0,
  transitRequestUsd: 0,
}

// USD por millón de tokens, según el endpoint de modelos del AI Gateway.
// cacheWrite: OpenAI no cobra la escritura del cache; Anthropic la cobra 1,25× la entrada.
type LlmPrice = { input: number; cachedInput: number; cacheWrite: number; output: number }
export const LLM_PRICES_PER_MILLION: Record<string, LlmPrice> = {
  'openai/gpt-5-mini': { input: 0.25, cachedInput: 0.025, cacheWrite: 0.25, output: 2 },
  'anthropic/claude-sonnet-5.5': { input: 2, cachedInput: 0.1, cacheWrite: 2.5, output: 10 },
  // Hasta 100k tokens de entrada; la clasificación del logo usa ~1k.
  'anthropic/claude-haiku-5.5': { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 },
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
    instagramSearchResultUsd: configuredCostRate('EXTRACTION_COST_INSTAGRAM_SEARCH_RESULT_USD', overrides.instagramSearchResultUsd ?? DEFAULT_COST_RATES.instagramSearchResultUsd),
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

const ALLOWED_TAG_GROUPS = { categories: CATEGORIES, moments: MOMENTS, cuisines: CUISINES, foods: FOODS, drinks: DRINKS, features: FEATURES, atmosphere: ATMOSPHERE, goodFor: GOOD_FOR, offers: OFFERS, style: STYLES } as const

export const SYSTEM_PROMPT = `Sos un curador de gastronomía de Montevideo. A partir de las fuentes, devolvé un JSON sobre el local objetivo. Trabajá en dos pasos y en este orden.

PASO 1 — facts
- facts es la lista de hechos concretos que dicen las fuentes sobre el local objetivo. Cada fact tiene id (F1, F2, F3… en orden, sin repetir), text (una frase corta en español), sourceId (el id de la fuente de donde sale) y kind: food, drink, feature, hours, dietary, price, reservations, contact u other.
- El text de cada fact va siempre en español, aunque la fuente esté en otro idioma. Traducí los nombres de platos y productos al nombre habitual en Uruguay ("Spanish omelette" → "tortilla de papas", "burger" → "hamburguesa"). El nombre propio del local no se traduce.
- Máximo 40 facts, de una frase corta cada uno. Priorizá los que sirven para tags, horarios, dietary y la descripción.
- Sólo hechos del local objetivo: ignorá otras sucursales, otras ciudades y otros países, aunque compartan nombre o cuenta (por ejemplo, un Instagram de otro país).
- Ignorá el contenido de tienda online: productos envasados, bolsas de café, suscripciones, insumos, merch, gift cards y sus precios. Ignorá también reseñas y puntajes.
- Las etiquetas sueltas de un directorio ("Tags: Brunch", "Categories: X") no son hechos.
- Nada inventado ni deducido sin base. Cada fuente indica si es OFICIAL (web o Instagram validado del local) o TERCEROS; si se contradicen, gana la OFICIAL.

PASO 2 — el resto del JSON, sólo a partir de facts
- tags es una lista de { group, id, facts } con las categorías, los tags y el style del local: group es categories, moments, cuisines, foods, drinks, features, atmosphere, goodFor, offers o style; id es uno de los ids permitidos de ese grupo (ver IDS PERMITIDOS); facts son los ids de los facts que lo respaldan (por ejemplo ["F3", "F7"]).
- support respalda los demás datos: una entrada { field, facts }, con los ids de los facts, para cada uno que completes, con field exactamente igual a uno de estos: dietary.vegan, dietary.vegetarian, dietary.glutenFree, price, reservations, hours, contact.phone, contact.whatsapp, contact.instagram, contact.website, contact.menuUrl, contact.reservationUrl, locatedIn, name, address.
- Lo que no cite un fact se descarta.
- proposedTag: en cada fact que no cites en ningún tag ni support, completá proposedTag: el id existente que debería haberse usado, un id nuevo en snake_case si ningún tag encaja, o null. proposedTag es null solo para anécdotas, historia de la marca, nombre o dirección del local, datos de contacto, medios de pago o información de otras sucursales. Si el fact describe comida, bebida, actividades o características del lugar, proponé un tag existente o uno nuevo. En los facts citados, null.
- Platos y bebidas concretos nunca van con proposedTag null: mapealos al tag más cercano (tapas o platos pequeños → tapas, y además picada si mencionan tablas, fiambres o quesos para compartir; postres dulces → desserts; jugos o licuados → smoothies; yogur, tostadas o similares → breakfast).
- Cada tag tiene que corresponder a al menos un fact. No pongas tags sin un fact que los respalde. Usá solamente los ids permitidos.
- Inferí tags razonables a partir de los facts. Ejemplo inventado: "pasan música con DJs los viernes y se llena a la salida de la oficina" → dj, after_office; "ideal para trabajar con la compu" → work. Pero foods, cuisines y dietary sólo con menciones explícitas o, en cuisines, platos típicos (ver abajo): nunca deduzcas platos, tipo de cocina ni opciones dietarias por el tipo de local. cuisines tiene máximo tres valores.
- cuisines sólo si es el estilo principal del lugar o una parte relevante de la carta, nunca por un plato suelto: una parrilla que tiene una pasta no es italian, ni un bar con unos tacos es mexican. Una cocina va si un fact la nombra ("cocina italiana", "comida mexicana", "taquería") o si al menos dos platos típicos distintos de ella (ver PLATOS TÍPICOS DE CADA COCINA) la identifican claramente: tacos y burritos → mexican; ceviche y lomo saltado → peruvian; arepas y tequeños → venezuelan; shawarma y falafel → middle_eastern; curry y naan → indian; kimchi y bibimbap → korean. Si no, no la pongas.
- Un lugar nikkei lleva nikkei y, además, japanese si sirve sushi u otro plato japonés, y peruvian si sirve ceviche u otro plato peruano.
- features, atmosphere y los goodFor work, solo, after_office y lgbtq_friendly también necesitan un fact que nombre el tag con palabras de esa idea ("tiene terraza", "ideal para trabajar", "ambiente tranquilo"). El RESUMEN ESTRUCTURADO DE EXA no alcanza solo para features, goodFor, offers ni atmosphere: necesitan un fact de otra fuente.
- atmosphere (quiet, lively, cozy, elegant) sólo con un fact que describa el ambiente del lugar. cozy sólo si la fuente dice textualmente acogedor o cozy: no lo deduzcas de otras palabras.
- Los momentos de goodFor (groups, date, kids_friendly, celebration, quick) van si un fact los nombra ("ideal para ir con amigos", "para una cita", "menú para chicos") o, por inferencia, sólo con señales concretas en los facts que cites: una señal fuerte, o dos débiles distintas.
  - groups: fuerte: picada o tabla para compartir. Débiles: tapas o platitos para compartir, cerveza tirada, tragos, ambiente animado, música en vivo o DJ, mesas grandes o largas.
  - date: sin señales fuertes. Débiles: ambiente tranquilo, íntimo, vinos o carta de vinos, cocina cuidada o de autor, reservas, ambiente acogedor.
  - kids_friendly: fuertes: menú infantil, sillas altas, juegos o espacio para niños. Débiles: patio, espacio amplio, propuesta familiar.
  - celebration: fuertes: eventos privados, salón para eventos. Débiles: reservas para grupos, tragos, lugar u ocasión especial.
  - quick: fuerte: al paso. Débiles: mostrador, para llevar, menú del día o ejecutivo.
  Citá en el tag los facts que traen esas señales. Sin señal concreta, no lo pongas: nunca por el tipo de local. events es para actividades culturales (talleres, charlas, muestras); eventos privados o festejos son celebration.
- Los facts de fuentes de terceros son válidos para tags de comida, bebida, características y momentos. Solo dietary necesita una mención explícita, y si una fuente oficial contradice a un tercero, gana la oficial.
- Platos concretos siempre se mapean a un tag: cortes de carne o achuras → grilled_meat; pescados, mariscos o arroces con mariscos → seafood; pastas rellenas o caseras → pasta; flan, panqueques u otros postres → desserts; bowls o ensaladas → salads; huevos o tostadas → breakfast. Variedad de cervezas → craft_beer o draft_beer. Transmisiones deportivas → el tag de pantallas para fútbol (watch_football).
- Si hay facts de bebidas, tiene que haber al menos un tag de bebida. Una mención genérica de tragos o cócteles → classic_cocktails. Tragos propios de la casa, de autor, o cócteles con una base especial (ej. a base de vino) → signature_cocktails.
- moments: no devuelvas late_night; lo decide el código con los horarios.
- features: open_kitchen sólo si se menciona una cocina a la vista o abierta; bar_seating sólo si se puede comer en la barra, no por tener una barra para pedir bebidas. delivery y takeaway sólo para comida del local, nunca envíos de una tienda online.
- Distinguí espacios al aire libre: patio = espacio interno o trasero; terrace = terraza o azotea elevada; sidewalk = mesas en la vereda. No los uses como sinónimos.
- Usá patio, terrace o sidewalk solo si la fuente dice explícitamente patio, terraza/azotea o vereda. Si solo dice al aire libre o mesas afuera sin detalle, usá outdoor.
- Sesiones de discos o escucha de vinilos → vinyl.
- Si una fuente dice que solo se paga en efectivo, usá cash_only.
- Jams, toques o bandas → live_music además de events.
- dishes: platos concretos de comida que aparecen en los facts, en español, en minúscula y con el nombre normalizado, sin artículos ni conectores sobrantes ("milanesas a la napolitana" → "milanesa napolitana"; "chivito al pan canadiense" → "chivito canadiense"). Cada plato tiene que estar en el texto de un fact. Máximo 15. Nada de bebidas, productos de tienda online ni categorías genéricas (comida casera, minutas).
- signature: hasta 3 ids de los tags que ya pusiste y que mejor definen al lugar (por qué es conocido), de cualquier grupo salvo categories. Tienen que estar en tags. Nunca servicios o logística (delivery, takeaway, wifi, outlets, accessible, pet_friendly, menu_of_the_day). Momentos (lunch, dinner, breakfast, brunch, afternoon_snack) sólo si el lugar se define por ese momento, por ejemplo un lugar de brunch.
- offers: sólo promociones o formatos concretos (merienda para dos, menú del día o ejecutivo, tenedor libre, happy hour).
- dietary no se infiere: has_options si un fact menciona opciones veganas, vegetarianas o sin TACC; fully sólo con una frase inequívoca de que todo el local cumple; "no" sólo si se dice explícitamente; si no, unknown. Si el menú menciona queso, huevo, manteca, leche o crema que no sean veganos, vegan no puede ser fully.
- Una versión vegetal explícita de un plato (de soja, de seitán, veggie, de lentejas) cuenta como vegetarian has_options.
- price sólo con precios o una mención explícita. reservations sólo con un fact que lo diga.
- Cada campo de contact va con "" si las fuentes no lo dicen.
- contact.website es exclusivamente la web propia del local. Los links de reservas, delivery, WhatsApp o Linktree van a su campo, nunca a website.
- Si las fuentes dicen que el local está dentro de otro lugar (shopping, mercado, galería, hotel, museo, polo gastronómico), completá locatedIn con el nombre de ese lugar. Si no lo dicen claramente, null. No lo deduzcas solo de la dirección.
- Si completás locatedIn, citá en support los facts que lo dicen, con field locatedIn.
- name es el nombre de la marca tal como lo escriben las fuentes, sin la sucursal (barrio, shopping, "sucursal X"). Citá en support, con field name, los facts que lo dicen. Si ninguna fuente lo nombra, "". El Nombre de LOCAL OBJETIVO sirve para identificar el local, no es una fuente.
- address es la dirección del local tal como aparece en una fuente, con su support (field address). Si ninguna fuente la trae, "". No copies la Dirección de LOCAL OBJETIVO.

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
- description.es: 2-3 frases en rioplatense, cercanas y sin exagerar, con palabras propias: qué es el lugar, su ambiente y por qué es conocido. Puede nombrar los platos o bebidas característicos, pero no enumerar la carta. Sin horarios y sin mencionar empresas ni terceros irrelevantes. description.en: la misma idea en inglés natural.
- La descripción sólo puede mencionar cosas que estén en facts, y todo lo que mencione tiene que estar en los tags: si decís DJ → dj; tragos o cócteles → classic_cocktails o signature_cocktails; after office → after_office; celebraciones → celebration; patio → patio. No menciones nada que no hayas tagueado.
- doubts: anotá en doubts lo que no supiste resolver (máx. 5). No inventes dudas.
- Si las fuentes dicen que el local todavía no abrió (próximamente, abre pronto, próxima apertura), anotalo en doubts empezando con «Todavía no abrió:».
- Si el Instagram oficial muestra el local funcionando (posts recientes, horarios), vale más que la web o terceros para decidir si está abierto o cerrado: no anotes «Todavía no abrió:» ni tomes como fact un cierre que informan terceros.
- Si el Instagram OFICIAL no es de este local (otro rubro, otra dirección u otro negocio con el mismo nombre), dejá contact.instagram vacío, no tomes facts de esa fuente y anotalo en doubts empezando con «Instagram rechazado:».

STYLE
- En tags, como mucho un item { group: "style", id, facts } con el estilo de la marca (el mismo en todas las sucursales): casual, intermedio o cuidado.
- casual: por porción, al paso, mostrador, de barrio, informal, bodegón. cuidado: cocina de autor, menú de pasos, carta de vinos, reservas recomendadas, elegante. intermedio: lo que queda entre los dos, con facts sobre la carta o el ambiente.
- Si algún fact trae una de esas señales, poné el style y citá esos facts: no lo dejes afuera cuando hay señales. Si no hay señales suficientes, no pongas style.

ÍCONO
- iconCategory es una sola clave de la lista de abajo: lo que el lugar es o por lo que es más conocido, no algo que vende de forma secundaria. Un bar de vinos que también tiene tablas es wine; una pizzería que vende cerveza es pizza.
- Las dietas (sin gluten, vegano, etc.) no definen la categoría, salvo que el lugar sea un restaurante veggie o saludable (salad).
- En una cadena, la categoría es de la marca: la misma en todas las sucursales.
- Elegí siempre la categoría más cercana, aunque no sea exacta.
${(Object.entries(ICON_CATEGORIES) as [string, { description: string }][]).map(([key, { description }]) => `- ${key}: ${description}`).join('\n')}

PLATOS TÍPICOS DE CADA COCINA
${(Object.entries(CUISINES) as [string, TagDef][]).filter(([, definition]) => definition.dishes).map(([id, definition]) => `- ${id}: ${definition.dishes!.es.join(', ')}`).join('\n')}

IDS PERMITIDOS
${(Object.entries(ALLOWED_TAG_GROUPS) as [string, Record<string, unknown>][]).map(([group, definitions]) => `- ${group}: ${Object.keys(definitions).join(', ')}`).join('\n')}`

function normalizedUrl(value: string): string | null {
  try {
    const url = new URL(value)
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

// Un "handle" con extensión de archivo (entradas.html, logo.png) sale de un link roto, no de un perfil.
const FILE_LIKE_HANDLE = /\.(?:html?|php|aspx?|jsp|cgi|png|jpe?g|gif|webp|svg|pdf|xml|json|js|css)$/i

function instagramProfileUrl(value: string): string | null {
  const candidate = value.trim()
  if (FILE_LIKE_HANDLE.test(candidate.replace(/\/+$/, ''))) return null
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

function samePlaceName(expected: string, actual: string): boolean {
  const left = canonical(expected).replace(/[^a-z0-9]+/g, ' ').trim()
  const right = canonical(actual).replace(/[^a-z0-9]+/g, ' ').trim()
  return Boolean(left && right && (left === right || left.length >= 5 && right.includes(left) || right.length >= 5 && left.includes(right)))
}

const GENERIC_NAME_WORDS = new Set(['bar', 'cafe', 'resto', 'restaurante', 'restaurant', 'the', 'los', 'las', 'del', 'club', 'casa'])

/** La marca sin espacios ni signos ni acentos, entera y sin las palabras genéricas ("" si no queda nada). */
function compactBrand(brand: string): { full: string; withoutGeneric: string } {
  const words = canonical(brand).split(/[^a-z0-9]+/).filter(Boolean)
  return { full: words.join(''), withoutGeneric: words.filter((word) => !GENERIC_NAME_WORDS.has(word)).join('') }
}

const LOCATION_SUFFIXES = ['uy', 'mvd', 'montevideo', 'uruguay']
const CATEGORY_SUFFIXES = ['bar', 'pizzabar', 'cafe', 'resto', 'restaurante', 'pizzeria', 'cerveceria']

/**
 * Cómo coincide el handle con la marca (entera, o sin genéricas si quedan 3+ letras), sin separadores
 * ni acentos: `exact` (cardenalcafe), `location` (marca + uy/mvd/montevideo/uruguay: panchova_uy,
 * brookies.mvd) o `category` (marca + rubro: hakuna_matata_pizzabar). null si no es la marca.
 */
export function brandHandleMatch(handle: string, brand: string): 'exact' | 'location' | 'category' | null {
  const normalized = canonical(handle).replace(/[^a-z0-9]+/g, '')
  const { full, withoutGeneric } = compactBrand(brand)
  const forms = [full, withoutGeneric.length >= 3 ? withoutGeneric : ''].filter(Boolean)
  if (forms.includes(normalized)) return 'exact'
  if (forms.some((form) => LOCATION_SUFFIXES.some((suffix) => normalized === `${form}${suffix}`))) return 'location'
  if (forms.some((form) => CATEGORY_SUFFIXES.some((suffix) => normalized === `${form}${suffix}`))) return 'category'
  return null
}

// País extranjero en el perfil (sin los posts, que hablan de viajes o sorteos: "Brasil te espera").
const FOREIGN_PROFILE = /\bbrasil\b|\bbrazil\b|\bargentina\b|\bbuenos aires\b|\.br\b|\.ar\b/
// Ciudades y países de otro lado. Sin los que también son calles comunes de Montevideo (España,
// Maldonado, Paraguay, Rivera, Colonia, Canelones…), para no rechazar un perfil por su dirección.
const OTHER_PLACE = /\b(?:argentina|buenos aires|rosario|mendoza|santiago de chile|asuncion|sao paulo|porto alegre|rio de janeiro|florianopolis|bogota|medellin|ciudad de mexico|cdmx|madrid|barcelona|miami|new york|nyc)\b/
// Ciudades de Uruguay fuera de Montevideo: una cadena las lista junto a sus locales de acá.
const OTHER_URUGUAY_CITY = /\b(?:punta del este|piriapolis|colonia del sacramento|jose ignacio|la paloma)\b/

/**
 * La bio (con el nombre del perfil) nombra otra ciudad u otro país. Una ciudad uruguaya no cuenta si
 * la bio también nombra Montevideo o el barrio del local ("📍POCITOS 📍PUNTA DEL ESTE 📍PARQUE RODÓ").
 */
function otherPlaceInBio(details: GooglePlaceDetailsResponse, profile: InstagramProfileData): boolean {
  const bio = canonical(`${profile.name}\n${profile.bio}`)
  if (OTHER_PLACE.test(bio)) return true
  if (!OTHER_URUGUAY_CITY.test(bio)) return false
  const neighborhood = neighborhoodDisplayName(getNeighborhood(details.anchor.latitude, details.anchor.longitude).neighborhoodId)
  return !/\bmontevideo\b/.test(bio) && !(neighborhood && bio.includes(canonical(neighborhood)))
}

/** Alguna palabra propia de la marca (3+ letras, no genérica) aparece en el texto. */
function sharesBrandWord(brand: string, text: string) {
  const haystack = ` ${canonical(text).replace(/[^a-z0-9]+/g, ' ')} `
  return canonical(brand).split(/[^a-z0-9]+/).some((word) => word.length >= 3 && !GENERIC_NAME_WORDS.has(word) && haystack.includes(` ${word} `))
}

// Rubros que no son gastronómicos: si el perfil se presenta así (y nada lo marca como gastronómico), el handle no alcanza.
const NON_GASTRONOMY_PROFILE = /\b(?:barberia|barber|barbershop|peluqueria|peluquero|peluquera|hair|salon de belleza|estetica|nails|manicura|tattoo|tatuajes?|ropa|indumentaria|moda|boutique|calzado|zapateria|inmobiliaria|real estate|propiedades|veterinaria|ferreteria|farmacia|optica|gimnasio|gym|odontologia|dentista|abogados?|estudio juridico|automotora|joyeria|floreria)\b/
// Una dirección en la bio: calle + número, y alguna marca de dirección (📍, esquina, dirección…), para no tomar años ni precios.
const BIO_STREET_NUMBER = /\b([a-z]{4,}) (\d{3,4})\b/g
const BIO_ADDRESS_MARKER = /📍|\b(?:esquina|esq|direccion|calle|avenida|av)\b/
const NOT_A_STREET = new Set(['desde', 'since', 'hasta', 'anio', 'year', 'temporada', 'edicion', 'fundado', 'fundada', 'apertura', 'abierto', 'abierta'])

/** El perfil se presenta con un rubro no gastronómico (en el nombre, la bio o la categoría, sin los posts). */
function nonGastronomyProfile(profile: InstagramProfileData): boolean {
  return !hasGastronomyCategory(profile) && NON_GASTRONOMY_PROFILE.test(canonical(`${profile.name} ${profile.bio} ${profile.category ?? ''}`))
}

/** La bio publica una dirección y no es la del local. */
function otherAddressInBio(bio: string, address: string): boolean {
  if (!BIO_ADDRESS_MARKER.test(canonical(bio)) || mentionsAddress(bio, address)) return false
  const text = canonical(bio).replace(/[^a-z0-9]+/g, ' ')
  return [...text.matchAll(BIO_STREET_NUMBER)].some((match) => !NOT_A_STREET.has(match[1]))
}

/** El teléfono del local en la bio o los posts. */
function profileHasPhone(details: GooglePlaceDetailsResponse, profile: InstagramProfileData): boolean {
  const googlePhone = normalizeUruguayPhone(details.phoneNumber ?? null)
  const bio = [profile.bio, ...(profile.posts ?? [])].join('\n')
  return Boolean(googlePhone && phonesInText(bio).map(normalizeUruguayPhone).includes(googlePhone))
}

/** El perfil enlaza la web oficial (la que se encontró o la de Google, que sólo confirma). */
function profileLinksWebsite(details: GooglePlaceDetailsResponse, profile: InstagramProfileData, websiteUrl: string | null): boolean {
  const linkedHosts = [websiteUrl, details.websiteUri ?? null]
    .filter((url): url is string => Boolean(url && !instagramProfileUrl(url) && !isSocialUrl(url)))
    .map(hostname).filter(Boolean)
  return profile.links.some((link) => linkedHosts.includes(hostname(link)))
}

/** Es el Instagram que Google tiene como web del lugar. */
function isGoogleWebsiteProfile(details: GooglePlaceDetailsResponse, profile: InstagramProfileData): boolean {
  return Boolean(details.websiteUri && instagramProfileUrl(details.websiteUri) === instagramProfileUrl(profile.url))
}

export type BusinessSignal = 'phone' | 'address' | 'website_link' | 'gastronomy'

/**
 * Señales de que el perfil es de un negocio: el teléfono del local, una dirección en la bio (la del local o una
 * calle con número), un link a la web oficial (o ser el Instagram que Google tiene para el lugar) o rubro
 * gastronómico en la bio o la categoría. Una categoría no gastronómica ("Digital creator") no cuenta.
 */
export function profileBusinessSignals(details: GooglePlaceDetailsResponse, profile: InstagramProfileData, websiteUrl: string | null): BusinessSignal[] {
  const bioText = canonical(profile.bio).replace(/[^a-z0-9]+/g, ' ')
  const hasAddress = mentionsAddress(profile.bio, details.anchor.address) ||
    (BIO_ADDRESS_MARKER.test(canonical(profile.bio)) && [...bioText.matchAll(BIO_STREET_NUMBER)].some((match) => !NOT_A_STREET.has(match[1])))
  return [
    ...(profileHasPhone(details, profile) ? ['phone' as const] : []),
    ...(hasAddress ? ['address' as const] : []),
    ...(profileLinksWebsite(details, profile, websiteUrl) || isGoogleWebsiteProfile(details, profile) ? ['website_link' as const] : []),
    ...(hasGastronomyCategory(profile) ? ['gastronomy' as const] : []),
  ]
}

/**
 * Valida un perfil de Instagram para el local y devuelve qué regla lo aceptó o lo rechazó.
 * `strict` (candidatos de la búsqueda por nombre, que trae homónimos de cualquier lado): además del
 * nombre exige una señal fuerte (Montevideo, la dirección, el teléfono o un link a la web oficial);
 * Uruguay, "uy" o "mvd" sueltos no alcanzan. Un handle que es la marca + sufijo de ubicación
 * (panchova_uy, brookies.mvd) cuenta como señal, salvo que la bio nombre otra ciudad u otro país; la
 * marca sola o + rubro (hakuna_matata_pizzabar) cuenta como nombre, no como ubicación.
 * Sin `strict` (candidatos de las fuentes del lugar), un handle que es la marca, sola o con sufijo de
 * ubicación o de rubro (cardenalcafe), alcanza si la bio no nombra otra ciudad u otro país.
 * Si el perfil se presenta con un rubro no gastronómico (barbería, ropa…) o publica otra dirección, ni el
 * handle ni el nombre alcanzan: sólo el teléfono del local en la bio o un link a su web oficial.
 */
export function instagramProfileMatch(details: GooglePlaceDetailsResponse, profile: InstagramProfileData, websiteUrl: string | null, strict = false): { accepted: boolean; rule: InstagramMatchRule } {
  const values = [profile.url, profile.name, profile.bio, ...profile.links, ...(profile.posts ?? [])]
  const normalized = canonical(values.join(' '))
  if (FOREIGN_PROFILE.test(canonical([profile.url, profile.name, profile.bio, ...profile.links].join(' ')))) return { accepted: false, rule: 'foreign_profile' }
  const brand = brandFromGoogleName(details.anchor.name)
  const bio = [profile.bio, ...(profile.posts ?? [])].join('\n')
  const hasPhone = profileHasPhone(details, profile)
  // La web de Google sólo confirma: un perfil que la enlaza, o que es el Instagram que Google tiene para el lugar.
  const hasWebsiteCrossLink = profileLinksWebsite(details, profile, websiteUrl)
  if (isGoogleWebsiteProfile(details, profile)) return { accepted: true, rule: 'google_website_match' }
  const mismatch: InstagramMatchRule | null = nonGastronomyProfile(profile) ? 'non_gastronomy_profile'
    : otherAddressInBio(profile.bio, details.anchor.address) ? 'other_address_in_bio' : null
  if (mismatch) {
    if (hasPhone) return { accepted: true, rule: 'mismatch_overridden_by_phone' }
    if (hasWebsiteCrossLink) return { accepted: true, rule: 'mismatch_overridden_by_website_link' }
    return { accepted: false, rule: mismatch }
  }
  const handleMatch = brandHandleMatch(instagramHandle(profile.url) ?? '', brand)
  if (handleMatch && (!strict || handleMatch === 'location')) {
    if (!otherPlaceInBio(details, profile)) return { accepted: true, rule: `handle_${handleMatch}` }
  }
  const hasName = samePlaceName(brand, profile.name) || Boolean(strict && handleMatch)
  const hasLocalSignal = strict ? /\bmontevideo\b/.test(normalized) : /\bmontevideo\b|\buruguay\b|\buru\b|\b(?:uy|mvd)\b/.test(normalized)
  const addressNumbers = canonical(details.anchor.address).match(/\b\d{2,}\b/g) ?? []
  const hasAddress = addressNumbers.some((number) => new RegExp(`\\b${number}\\b`).test(normalized))
  if (hasName && hasLocalSignal) return { accepted: true, rule: 'name_and_local_signal' }
  if (hasName && hasAddress) return { accepted: true, rule: 'name_and_address' }
  if (hasName && hasWebsiteCrossLink) return { accepted: true, rule: 'name_and_website_link' }
  // Nombre corto o distinto ("SUMI" para "Sumi Sushi"): alcanza con una palabra de la marca en el
  // nombre o el handle si la bio trae la dirección del local o su teléfono.
  if (sharesBrandWord(brand, `${profile.name} ${profile.url}`)) {
    if (mentionsAddress(bio, details.anchor.address)) return { accepted: true, rule: 'brand_word_and_address' }
    if (hasPhone) return { accepted: true, rule: 'brand_word_and_phone' }
  }
  return { accepted: false, rule: 'no_identity_signal' }
}

export function classifyContact(contact: Contact) {
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

// Dominios de otros países (".com.br", ".ar"…). ".co" no: lo usan directorios uruguayos.
const FOREIGN_TLDS = new Set(['br', 'ar', 'cl', 'py', 'pe', 'bo', 'mx', 'es', 'ec', 've', 'ph', 'pt', 'it', 'fr', 'de', 'uk', 'au', 'ca', 'us'])
// Señales de dirección de otro país: ciudades, CEP brasileño o prefijos telefónicos de Brasil y Argentina.
const FOREIGN_ADDRESS = /\b(?:porto alegre|sao paulo|rio de janeiro|florianopolis|curitiba|buenos aires|santiago de chile|asuncion)\b|\b\d{5}-\d{3}\b|\+\s?5[45]\b/

/** Fuente de otro país: dominio extranjero, o dirección extranjera sin ninguna mención de Uruguay o Montevideo. */
export function isForeignSource(url: string, text: string): boolean {
  const host = hostname(url)
  if (host && FOREIGN_TLDS.has(host.split('.').at(-1)!)) return true
  const normalized = canonical(text)
  return FOREIGN_ADDRESS.test(normalized) && !/\b(?:uruguay|montevideo)\b/.test(normalized)
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
    url: EXA_SUMMARY_URL,
    text: [
      'RESUMEN ESTRUCTURADO DE EXA',
      `Descripción: ${content.description}`,
      `Dirección: ${content.address}`,
      `Contacto: ${content.contact_info}`,
      `Horarios (texto original): ${content.open_hours_raw}`,
      content.open_hours.length ? `Horarios estructurados:\n${content.open_hours.map((hours) => `${hours.days}: ${hours.opens} - ${hours.closes ?? 'sin cierre publicado'}`).join('\n')}` : '',
      content.knows_before_you_go ? `Antes de ir: ${content.knows_before_you_go}` : '',
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

const MAX_DIRECTED_INSTAGRAM_HANDLES = 5
// Agregadores que publican perfiles de Instagram en la URL (viralist.ai/instagram/creators/<handle>).
const INSTAGRAM_AGGREGATOR_PATH = /\/instagram\/(?:[a-z-]+\/)?([a-z0-9._]{1,30})\/?$/i

/** Handles de la búsqueda dirigida a Instagram: URLs de instagram.com, de agregadores y links a perfiles en el texto. */
export function instagramHandlesFromResults(results: Pick<ExaPlaceResult, 'url' | 'text' | 'highlights'>[]): string[] {
  const handles = results.flatMap((result) => {
    const text = result.text ?? result.highlights.join('\n')
    let aggregated: string | null = null
    try {
      const url = new URL(result.url)
      if (!/(?:^|\.)instagram\.com$/i.test(url.hostname)) aggregated = INSTAGRAM_AGGREGATOR_PATH.exec(url.pathname)?.[1] ?? null
    } catch { /* URL inválida */ }
    return [
      instagramHandle(result.url),
      aggregated && instagramHandle(aggregated),
      ...(text.match(/instagram\.com\/[A-Za-z0-9._]{1,30}/gi) ?? []).map(instagramHandle),
    ]
  }).filter((handle): handle is string => Boolean(handle))
  return [...new Set(handles)].slice(0, MAX_DIRECTED_INSTAGRAM_HANDLES)
}

/** El perfil que Exa propone en instagram_profile_url, normalizado; null si vino vacío o no es un perfil. */
export function exaProfileCandidate(exa: Pick<ExaPlaceResponse, 'output'> | null): string | null {
  return instagramProfileUrl(exa?.output.content.instagram_profile_url ?? '')
}

/** Cada candidato (URL de perfil normalizada, en el orden en que aparece) con las fuentes que lo propusieron. */
export function instagramCandidateOrigins(exa: ExaPlaceResponse | null, websiteLinks: string[] = [], directedHandles: string[] = []): Map<string, InstagramCandidateOrigin[]> {
  const instagramFromContactInfo = (value: string) => {
    const urls = value.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/[A-Za-z0-9._]{1,30}\/?/gi) ?? []
    // Cualquier @handle, con o sin la etiqueta "Instagram" (el resumen a veces lo pone como Email).
    const handles = instagramMentions(value).map((handle) => `@${handle}`)
    return [...urls, ...handles]
  }
  const values: [InstagramCandidateOrigin, string][] = [
    ...instagramFromContactInfo(exa?.output.content.contact_info ?? '').map((value): [InstagramCandidateOrigin, string] => ['exa_contact_info', value]),
    ['exa_profile_field', exa?.output.content.instagram_profile_url ?? ''],
    ...(exa?.results.flatMap((result) => [result.url, ...(result.extras?.links ?? [])]) ?? []).map((value): [InstagramCandidateOrigin, string] => ['exa_result', value]),
    ...websiteLinks.map((value): [InstagramCandidateOrigin, string] => ['website', value]),
    ...directedHandles.map((value): [InstagramCandidateOrigin, string] => ['exa_instagram_search', value]),
  ]
  const origins = new Map<string, InstagramCandidateOrigin[]>()
  for (const [origin, value] of values) {
    const url = instagramProfileUrl(value)
    if (!url) continue
    const current = origins.get(url) ?? []
    if (!current.includes(origin)) origins.set(url, [...current, origin])
  }
  return origins
}

/** Suma a cada decisión las fuentes que propusieron el handle. */
function withOrigins(candidates: InstagramAuditCandidate[], origins: ReadonlyMap<string, InstagramCandidateOrigin[]>): InstagramAuditCandidate[] {
  const byHandle = new Map([...origins].map(([url, list]) => [instagramHandle(url), list]))
  return candidates.map((candidate) => {
    const list = byHandle.get(candidate.handle)
    return list ? { ...candidate, origins: list } : candidate
  })
}

/** Suma al uso del clasificador del logo el de las fotos clasificadas al elegir el perfil. */
export function withPictureClassifications(logo: LogoOutcome, pictures: (PictureClassification | null)[]): LogoOutcome {
  const usages = [logo.classification, ...pictures.map((picture) => picture?.classification ?? null)]
    .filter((item): item is NonNullable<LogoOutcome['classification']> => item !== null)
  if (usages.length <= 1) return { ...logo, classification: usages[0] ?? null }
  const sum = (field: keyof LlmUsage) => usages.some((item) => item.usage[field] !== null)
    ? usages.reduce((total, item) => total + (item.usage[field] ?? 0), 0)
    : null
  return {
    ...logo,
    classification: {
      model: usages[0].model,
      usage: { inputTokens: sum('inputTokens'), cachedInputTokens: sum('cachedInputTokens'), cacheWriteTokens: sum('cacheWriteTokens'), outputTokens: sum('outputTokens'), gatewayCostUsd: sum('gatewayCostUsd') },
    },
  }
}

type InstagramTieBreak = InstagramTieBreakRule
/** tieHandles: los perfiles válidos que empataron (falta sin empate). */
type InstagramValidation = { profile: InstagramProfileData | null; candidates: InstagramAuditCandidate[]; tieBreak?: InstagramTieBreak; tieHandles?: string[] }
export type ProminenceSourceSignals = { instagramFollowers: number | null }
const NO_PROMINENCE_SIGNALS: ProminenceSourceSignals = { instagramFollowers: null }
const NO_LOGO: LogoOutcome = { logo: null, review: { status: 'missing', reason: 'no_instagram', kind: null }, classification: null }

async function validatedInstagram(
  provider: InstagramProvider | undefined,
  details: GooglePlaceDetailsResponse,
  candidates: string[],
  websiteUrl: string | null = null,
  // Cupo de Apify (y reintentos ante 429) alrededor de la llamada.
  limited: <T>(operation: () => Promise<T>) => Promise<T> = (operation) => withServiceLimit('apify', operation),
  pictureStatus: PictureStatus = defaultPictureStatus,
  pictureKind: PictureKind = noPictureKind,
): Promise<InstagramValidation> {
  const handles = candidates.map(instagramHandle).filter((handle): handle is string => Boolean(handle))
  if (candidates.length === 0) return { profile: null, candidates: [] }
  if (!provider?.configured) return {
    profile: null,
    candidates: handles.map((handle) => ({ handle, decision: 'unavailable', reason: 'instagram_provider_not_configured' })),
  }
  let profiles: InstagramProfileData[]
  try {
    profiles = await limited(() => provider.scrapeMany(candidates))
  } catch (error) {
    // Ya con los reintentos: el lugar no sigue, para no guardarlo sin Instagram.
    throw new InstagramProviderFailure(error)
  }
  // Varios válidos en la primera pasada: se desempata igual (la regla de la primera pasada no aplica).
  return selectInstagram(details, candidates, profiles, websiteUrl, false, { firstPassUrls: new Set(), pictureStatus, pictureKind })
}

/** Elige el perfil validado entre los candidatos; sólo vale si queda uno. */
const GASTRONOMY_CATEGORY = /restaurant|\bbar\b|\bpub\b|cafe|coffee|bakery|brewery|ice cream|pizza|burger|food|steakhouse|wine|cocktail|\bdeli\b|dessert/
const GASTRONOMY_BIO = /\b(?:bar|bares|cafe|cafes|restaurante|restaurantes|resto|restos|tragos?|cerveceria|cervecerias|heladeria|heladerias)\b/

/** Rubro gastronómico: la categoría de Instagram o alguna palabra del rubro en la bio (sin los posts). */
export function hasGastronomyCategory(profile: Pick<InstagramProfileData, 'category' | 'bio'>): boolean {
  return GASTRONOMY_CATEGORY.test(canonical(profile.category ?? '')) || GASTRONOMY_BIO.test(canonical(profile.bio))
}

/** Los perfiles con el valor más alto (sin valor cuenta como el más bajo); todos si ninguno tiene valor. */
function highest(profiles: InstagramProfileData[], value: (profile: InstagramProfileData) => number | null): InstagramProfileData[] {
  const values = profiles.map(value)
  const max = Math.max(...values.map((item) => item ?? -Infinity))
  return max === -Infinity ? profiles : profiles.filter((_, index) => values[index] === max)
}

/** Si la foto de perfil es real, el avatar genérico de Instagram o no se pudo saber. */
type PictureStatus = (profile: InstagramProfileData) => Promise<ProfilePictureStatus>
const defaultPictureStatus: PictureStatus = (profile) => profilePictureStatus(profile.profilePicUrl)
/** Qué muestra la foto de perfil (logo, persona…), o null si no se pudo saber. */
type PictureKind = (profile: InstagramProfileData) => Promise<LogoKind | null>
const noPictureKind: PictureKind = async () => null

/**
 * Entre varios perfiles válidos: primero el que también fue candidato de la primera pasada (vino de las
 * fuentes del lugar), después el único con rubro gastronómico, después el que tiene foto real frente al
 * avatar genérico de Instagram (los que no se pudieron revisar siguen), después el del post más reciente y
 * por último el de más seguidores. Cada regla achica el grupo para la siguiente. Si sigue el empate, ninguno.
 */
export async function breakInstagramTie(
  tied: InstagramProfileData[],
  firstPassUrls: ReadonlySet<string>,
  pictureStatus: PictureStatus = defaultPictureStatus,
): Promise<{ profile: InstagramProfileData | null; tieBreak: InstagramTieBreak }> {
  let remaining = tied
  const fromSources = remaining.filter((profile) => firstPassUrls.has(profile.url))
  if (fromSources.length === 1) return { profile: fromSources[0], tieBreak: 'first_pass_candidate' }
  if (fromSources.length > 1) remaining = fromSources
  const gastronomy = remaining.filter(hasGastronomyCategory)
  if (gastronomy.length === 1) return { profile: gastronomy[0], tieBreak: 'gastronomy' }
  if (gastronomy.length > 1) remaining = gastronomy
  // Sólo baja las fotos si hace falta llegar acá (como mucho los empatados).
  const pictures = await Promise.all(remaining.map(pictureStatus))
  if (pictures.includes('real') && pictures.includes('generic')) {
    remaining = remaining.filter((_, index) => pictures[index] !== 'generic')
    if (remaining.length === 1) return { profile: remaining[0], tieBreak: 'profile_picture' }
  }
  const latest = highest(remaining, (profile) => profile.latestPostAt ? Date.parse(profile.latestPostAt) : null)
  if (latest.length === 1) return { profile: latest[0], tieBreak: 'latest_post' }
  const followed = highest(latest, (profile) => profile.followers ?? null)
  if (followed.length === 1) return { profile: followed[0], tieBreak: 'followers' }
  return { profile: null, tieBreak: 'unresolved' }
}

async function selectInstagram(
  details: GooglePlaceDetailsResponse,
  candidates: string[],
  profiles: InstagramProfileData[],
  websiteUrl: string | null,
  strict = false,
  // Con varios válidos se desempata (los de la primera pasada ganan primero). pictureKind clasifica la foto de los
  // aceptados sin señales de negocio.
  tie: { firstPassUrls: ReadonlySet<string>; pictureStatus: PictureStatus; pictureKind?: PictureKind } | null = null,
): Promise<InstagramValidation> {
  const requestedProfiles = new Set(candidates.map(instagramProfileUrl).filter(Boolean))
  const rules = new Map<string, InstagramMatchRule>()
  const accepted: InstagramProfileData[] = []
  for (const profile of profiles) {
    const profileUrl = instagramProfileUrl(profile.url)
    if (!profileUrl || !requestedProfiles.has(profileUrl)) continue
    let match = instagramProfileMatch(details, profile, websiteUrl, strict)
    // Aceptado sólo por el nombre, sin ninguna señal de negocio y con la foto de una persona: es una cuenta personal
    // con el nombre de la marca. Si la foto no se pudo clasificar, se acepta como antes.
    if (match.accepted && profileBusinessSignals(details, profile, websiteUrl).length === 0 && await (tie?.pictureKind ?? noPictureKind)(profile) === 'person') {
      match = { accepted: false, rule: 'personal_account' }
    }
    rules.set(profileUrl, match.rule)
    if (match.accepted) accepted.push({ ...profile, url: profileUrl })
  }
  const unique = new Map(accepted.flatMap((profile) => {
    return [[profile.url, profile] as const]
  }))
  const tieBroken = tie && unique.size > 1 ? await breakInstagramTie([...unique.values()], tie.firstPassUrls, tie.pictureStatus) : null
  const selected = unique.size === 1 ? [...unique.values()][0] : tieBroken?.profile ?? null
  const acceptedUrls = new Set(accepted.map((profile) => profile.url))
  return {
    profile: selected,
    ...(tieBroken ? { tieBreak: tieBroken.tieBreak, tieHandles: [...unique.keys()].map(instagramHandle).filter((handle): handle is string => Boolean(handle)) } : {}),
    candidates: candidates.flatMap((candidate): InstagramAuditCandidate[] => {
      const url = instagramProfileUrl(candidate)
      const handle = url && instagramHandle(url)
      if (!url || !handle) return []
      const rule = rules.get(url)
      const withRule = rule ? { rule } : {}
      if (selected?.url === url) return [{ handle, decision: 'selected' as const, reason: 'validated_exact_place_profile', ...withRule }]
      if (acceptedUrls.has(url)) return [{ handle, decision: 'discarded' as const, reason: selected ? 'tie_break_lost' : 'multiple_valid_profiles', ...withRule }]
      const profile = profiles.find((item) => instagramProfileUrl(item.url) === url)
      const reason = !profile ? 'not_returned_by_provider' : rule === 'personal_account' ? 'personal_account' : 'identity_or_location_mismatch'
      return [{ handle, decision: 'discarded' as const, reason, ...withRule }]
    }),
  }
}

/**
 * Términos de la búsqueda por nombre, en orden: la marca tal cual (sin los signos que el actor rechaza),
 * sin espacios ni signos, entera + "uy", sin palabras genéricas + "uy" (si queda algo), y lo mismo con "mvd".
 */
export function instagramSearchTerms(brand: string): string[] {
  const asIs = instagramSearchText(brand)
  const { full, withoutGeneric } = compactBrand(asIs)
  const suffixed = ['uy', 'mvd'].flatMap((suffix) => [full && `${full}${suffix}`, withoutGeneric && `${withoutGeneric}${suffix}`])
  return [...new Set([asIs, full, ...suffixed].filter(Boolean))]
}

// Perfiles distintos que revisa el respaldo por lugar, sumando todas las variantes.
const MAX_FALLBACK_PROFILES = 10

type InstagramSearchOutcome = { candidates: string[]; validation: InstagramValidation; chargedResults: number; terms: string[] }

/**
 * Respaldo: busca la marca en Instagram (Apify) y valida esos perfiles con los datos que trae la
 * búsqueda, sin volver a pedirlos, y en modo estricto. Cada término corre sólo si los anteriores no
 * dieron un perfil válido, hasta revisar MAX_FALLBACK_PROFILES perfiles. Si Apify falla (ya con los reintentos), lanza InstagramProviderFailure.
 */
async function searchedInstagram(
  provider: InstagramProvider,
  details: GooglePlaceDetailsResponse,
  brand: string,
  websiteUrl: string | null,
  limited: <T>(operation: () => Promise<T>) => Promise<T>,
  firstPassCandidates: string[] = [],
  // Cuentas de otros lugares (agregadoras): tampoco valen si las trae la búsqueda.
  excluded: ReadonlySet<string> = new Set(),
  pictureStatus: PictureStatus = defaultPictureStatus,
  pictureKind: PictureKind = noPictureKind,
): Promise<InstagramSearchOutcome> {
  const candidates = new Set<string>()
  const decisions = new Map<string, InstagramAuditCandidate>()
  const firstPassUrls = new Set(firstPassCandidates.map(instagramProfileUrl).filter((url): url is string => Boolean(url)))
  let profile: InstagramProfileData | null = null
  let tieBreak: InstagramTieBreak | undefined
  let tieHandles: string[] | undefined
  let chargedResults = 0
  const terms: string[] = []
  for (const term of instagramSearchTerms(brand)) {
    const remaining = MAX_FALLBACK_PROFILES - candidates.size
    if (remaining <= 0) break
    terms.push(term)
    const search: InstagramSearchResult = await limited(() => provider.searchProfiles!(term, Math.min(INSTAGRAM_SEARCH_LIMIT, remaining))).catch((error: unknown) => {
      throw new InstagramProviderFailure(error)
    })
    chargedResults += search.chargedResults
    const urls = [...new Set(search.profiles.map((item) => instagramProfileUrl(item.url)).filter((url): url is string => url !== null && !excluded.has(instagramHandle(url) ?? '')))]
    // Los que ya salieron en otra variante no cuentan de nuevo; los nuevos, hasta el tope.
    const fresh = urls.filter((url) => !candidates.has(url)).slice(0, remaining)
    const found = urls.filter((url) => candidates.has(url) || fresh.includes(url))
    fresh.forEach((url) => candidates.add(url))
    const validation = await selectInstagram(details, found, search.profiles, websiteUrl, true, { firstPassUrls, pictureStatus, pictureKind })
    if (validation.tieBreak) {
      tieBreak = validation.tieBreak
      tieHandles = validation.tieHandles
    }
    // Un perfil que ya salió en otra búsqueda conserva su primera decisión, salvo que ahora quede elegido.
    for (const decision of validation.candidates) {
      if (!decisions.has(decision.handle) || decision.decision === 'selected') decisions.set(decision.handle, decision)
    }
    if (validation.profile) {
      profile = validation.profile
      break
    }
  }
  return { candidates: [...candidates], validation: { profile, candidates: [...decisions.values()], ...(tieBreak ? { tieBreak, tieHandles } : {}) }, chargedResults, terms }
}

// Motivos de rechazo de la primera pasada que justifican buscar: el perfil no era, Apify no lo trajo, la cuenta
// era de otro lugar (agregadora) o era una cuenta personal con el nombre de la marca.
const SEARCHABLE_REJECTIONS = new Set(['identity_or_location_mismatch', 'not_returned_by_provider', 'shared_with_other_place', 'personal_account'])

/**
 * Por qué corre el respaldo, o null si no corre: sin candidatos, o con todos los candidatos rechazados
 * por identidad o porque Apify no los trajo (no si Apify falló o hubo varios perfiles válidos).
 */
export function instagramFallbackReason(candidates: string[], validation: InstagramValidation | null): string | null {
  if (candidates.length === 0) return 'sin candidato'
  if (!validation || validation.profile || validation.candidates.length === 0) return null
  if (!validation.candidates.every((candidate) => candidate.decision === 'discarded' && SEARCHABLE_REJECTIONS.has(candidate.reason))) return null
  return `candidato rechazado: ${validation.candidates.map((candidate) => `${candidate.handle}, ${candidate.reason}`).join('; ')}`
}

/**
 * El nombre está confirmado antes del LLM: la web o algún resultado de Exa (no extranjero) nombra la
 * marca. Es la misma regla que `brandConfirmed` en postProcess; el resumen de Exa no cuenta porque sale
 * de una búsqueda con ese nombre. Sin nombre confirmado no se busca la marca en Instagram.
 */
function brandNamedInSources(brand: string, website: WebsitePageData | null, exa: ExaPlaceResponse | null): boolean {
  const candidates = [
    ...(website ? [sourceFromWebsite(website)] : []),
    ...(exa ? sourceFromExa(exa).filter((source) => !isForeignSource(source.url, source.text)) : []),
  ]
  return filterSources(candidates).some((source) => hasPhrase(source.text, brand))
}

/** Une la primera pasada con el respaldo: el perfil es el del respaldo y, por handle, gana su decisión. */
function mergedInstagramValidation(first: InstagramValidation | null, fallback: InstagramValidation): InstagramValidation {
  const decisions = new Map((first?.candidates ?? []).map((candidate) => [candidate.handle, candidate]))
  for (const candidate of fallback.candidates) {
    // Una cuenta personal sigue anotada como tal aunque el respaldo (estricto) la descarte por otra regla.
    if (decisions.get(candidate.handle)?.reason === 'personal_account' && candidate.decision !== 'selected') continue
    decisions.set(candidate.handle, candidate)
  }
  return { profile: fallback.profile, candidates: [...decisions.values()] }
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
  // Sin reintentos del AI SDK: los 429 los reintenta withRateLimitRetry y quedan en review.rateLimits.
  const result = await generateText({ ...mainExtractionRequest(target, sources, config), maxRetries: 0 })
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
    maxRetries: 0,
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

/**
 * Un tag puede ir en signature salvo servicios y logística. Un momento sólo si define al lugar:
 * lo nombra el nombre o la primera oración de la descripción, la que dice qué es el lugar.
 */
export function signatureAllowed(id: string, name: string, description: string) {
  if (SIGNATURE_EXCLUDED.has(id)) return false
  if (!SIGNATURE_MOMENTS.has(id)) return true
  const definition = `${name}. ${description.split(/(?<=\.)\s/)[0] ?? ''}`
  const moment = MOMENTS[id as keyof typeof MOMENTS]
  return [moment.label.es, ...moment.synonyms.es].some((phrase) => hasPhrase(definition, phrase))
}

/** Algún texto nombra la cocina: su label o un sinónimo de tags.ts, sin acentos. */
export function cuisineMentioned(id: string, texts: string[]) {
  return Object.hasOwn(CUISINES, id) && tagMentioned(id, texts)
}

// Con nikkei aceptada, a estas les alcanza un plato típico (sushi → japonesa, ceviche → peruana).
const NIKKEI_PARTNERS = new Set(['japanese', 'peruvian'])

/**
 * Respaldo de una cocina en los facts: alguno la nombra (label o sinónimo), o aparecen al menos dos platos típicos
 * distintos de ella (tags.ts, en español como los facts). Un plato suelto no alcanza, salvo para japonesa y peruana
 * en un lugar nikkei. Devuelve la evidencia: explícita si la nombran, inferida con los platos si no.
 */
export function cuisineSupport(id: string, facts: { id: string; text: string }[], acceptedCuisines: readonly string[] = []): TagEvidence | null {
  if (!Object.hasOwn(CUISINES, id)) return null
  for (const fact of facts) {
    const phrase = tagMention(id, [fact.text])
    if (phrase) return { tag: id, mode: 'explicit', signals: [phrase], factIds: [fact.id] }
  }
  const matches = (CUISINES[id as keyof typeof CUISINES].dishes?.es ?? []).flatMap((dish) => {
    const fact = facts.find((candidate) => dishSupportedBy(dish, candidate.text))
    return fact ? [{ dish, factId: fact.id }] : []
  })
  const needed = acceptedCuisines.includes('nikkei') && NIKKEI_PARTNERS.has(id) ? 1 : 2
  if (matches.length < needed) return null
  return { tag: id, mode: 'inferred', signals: matches.map((match) => match.dish), factIds: [...new Set(matches.map((match) => match.factId))] }
}

/** Respaldo de cada cocina propuesta; nikkei se resuelve primero porque baja el umbral de japonesa y peruana. */
export function supportedCuisines(ids: string[], facts: { id: string; text: string }[]) {
  const accepted = ids.includes('nikkei') && cuisineSupport('nikkei', facts) ? ['nikkei'] : []
  const supported = new Map<string, TagEvidence>()
  for (const id of ids) {
    const evidence = cuisineSupport(id, facts, accepted)
    if (evidence) supported.set(id, evidence)
  }
  return supported
}

/** Algún texto contiene el label o un sinónimo del tag (es o en), como frase completa y sin acentos. */
export function tagMentioned(id: string, texts: string[]) {
  return tagMention(id, texts) !== null
}

/** El label o sinónimo del tag que aparece en algún texto; null si ninguno. */
export function tagMention(id: string, texts: string[]): string | null {
  const definition = findDef(id)
  if (!definition) return null
  const phrases = [definition.label.es, definition.label.en, ...definition.synonyms.es, ...definition.synonyms.en]
  for (const text of texts) {
    const phrase = phrases.find((candidate) => hasPhrase(text, candidate))
    if (phrase) return phrase
  }
  return null
}

// El resumen de Exa no alcanza solo para estos grupos: es donde inventa (accesible, pet friendly…).
const NOT_FROM_EXA_SUMMARY_GROUPS = new Set(['features', 'goodFor', 'offers', 'atmosphere'])
// Estos grupos además necesitan un fact que nombre el tag, como las cocinas.
const MENTION_REQUIRED_GROUPS = new Set(['features', 'goodFor', 'atmosphere'])

// Palabras que no cuentan para respaldar un plato: "milanesas a la napolitana" respalda "milanesa napolitana".
const DISH_STOPWORDS = new Set(['a', 'la', 'las', 'el', 'los', 'de', 'del', 'con', 'al', 'y'])

/** Palabras significativas sin acentos, con singular y plural igualados (milanesas → milanesa, panes → pan). */
function dishWords(value: string) {
  return canonical(value).split(/[^a-z0-9]+/).filter((word) => word && !DISH_STOPWORDS.has(word))
    .map((word) => word.length > 3 ? word.replace(/s$/, '').replace(/e$/, '') : word)
}

/** Un plato está respaldado si todas sus palabras significativas aparecen en el texto del fact. */
export function dishSupportedBy(dish: string, factText: string) {
  const needed = dishWords(dish)
  const available = new Set(dishWords(factText))
  return needed.length > 0 && needed.every((word) => available.has(word))
}

// El esquema del LLM pide los grupos por separado; el post-proceso los une en tags.
const LLM_TAG_GROUPS = ['moments', 'cuisines', 'foods', 'drinks', 'features', 'atmosphere', 'goodFor', 'offers'] as const satisfies readonly TagGroupName[]
// El código los calcula desde los horarios: un proposedTag no los aplica.
const HOURS_DERIVED_TAGS = new Set(['late_night', 'breakfast', 'lunch', 'dinner'])
const MAX_CUISINES = 3

type ProcessedExtraction = Omit<PlaceExtraction, 'hours' | 'facts' | 'support' | 'tags' | 'highlights' | 'doubts' | 'locatedIn' | 'name' | 'address' | 'dishes' | 'signature' | 'contact' | 'iconCategory'> & {
  contact: Contact
  name: string
  address: string | null
  locatedIn: string | null
  highlights: { es: string; en: string }[]
  categories: CategoryId[]
  tags: TagId[]
  hours: { raw: string | null; display: { es: string; en: string } | null; slots: HoursSlot[] }
}

// Íconos de comida al paso: sin señales ni precio, el lugar es casual. Cualquier otro, intermedio.
const CASUAL_ICONS = new Set(['hot_dog', 'burger', 'fries', 'pizza', 'sandwich', 'beer_pub', 'ice_cream'])

/** style sin señales: del precio (low → casual, moderate → intermedio, high o más → cuidado) y, sin precio, del ícono. */
export function fallbackStyle(price: PlaceExtraction['price'], iconCategory: string): { style: StyleId; evidence: TagEvidence & { basis: 'price' | 'icon' } } {
  if (price !== 'unknown') {
    const style: StyleId = price === 'low' ? 'casual' : price === 'moderate' ? 'intermedio' : 'cuidado'
    return { style, evidence: { tag: style, mode: 'inferred', basis: 'price', signals: [`precio: ${price}`], factIds: [] } }
  }
  const style: StyleId = CASUAL_ICONS.has(iconCategory) ? 'casual' : 'intermedio'
  return { style, evidence: { tag: style, mode: 'inferred', basis: 'icon', signals: [`ícono: ${iconCategory}`], factIds: [] } }
}

type SearchTextFields = Pick<PlaceEnrichmentDraft, 'name' | 'neighborhoodId' | 'description' | 'locatedIn' | 'dietary' | 'highlights' | 'dishes' | 'style'> & {
  categories: readonly string[]
  tags: readonly string[]
  signature: string[]
}

/**
 * Lo que entra en embeddingText y keywordText: nombre, barrio, descripción, categorías, tags, dietas, highlights,
 * platos, signature y style. Los facts no entran. Lo usan postProcess y el replay que reescribe el style.
 */
export function searchTextInput(place: SearchTextFields) {
  const tags = [...place.categories, ...place.tags,
    ...(place.dietary.vegan === 'has_options' || place.dietary.vegan === 'fully' ? ['vegan'] : []),
    ...(place.dietary.vegetarian === 'has_options' || place.dietary.vegetarian === 'fully' ? ['vegetarian'] : []),
    ...(place.dietary.glutenFree === 'has_options' || place.dietary.glutenFree === 'fully' ? ['gluten_free'] : [])]
  return {
    name: place.name,
    neighborhood: neighborhoodDisplayName(place.neighborhoodId) ?? 'Montevideo',
    description: place.description,
    locatedIn: place.locatedIn,
    tags: [...new Set(tags)],
    highlights: place.highlights,
    dishes: place.dishes,
    signature: place.signature,
    style: place.style,
  }
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

// Fijos y celulares: libphonenumber también da por válidos números cortos (UAN) como "2110".
const PHONE_TYPES = new Set(['FIXED_LINE', 'MOBILE', 'FIXED_LINE_OR_MOBILE'])
const isUruguayPhone = (phone: PhoneNumber | undefined): phone is PhoneNumber =>
  phone?.country === 'UY' && phone.isValid() && PHONE_TYPES.has(phone.getType() ?? '')

/** Fijo o celular válido de Uruguay según libphonenumber, en formato internacional; null si no lo es. */
function normalizeUruguayPhone(value: string | null) {
  if (!value) return null
  const raw = value.trim().replace(/^tel:/i, '')
  const digits = raw.replace(/\D/g, '')
  // "598…" o "00598…" sin el +: libphonenumber lo tomaría como número nacional.
  const candidate = /^(?:00)?598\d{8}$/.test(digits) && !raw.startsWith('+') ? `+${digits.replace(/^00/, '')}` : raw
  const phone = parsePhoneNumberFromString(candidate, 'UY')
  return isUruguayPhone(phone) ? phone.formatInternational() : null
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

function normalizeContact(contact: Contact) {
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

export type DeterministicContact = Partial<Pick<PlaceExtraction['contact'], 'phone' | 'instagram' | 'reservationUrl'>>

function linksInText(value: string): string[] {
  return value.match(/https?:\/\/[^\s<>"')\]]+/gi)?.map((link) => link.replace(/[.,;:!?]+$/, '')) ?? []
}

function sourceLinks(source: Source): string[] {
  return [source.url, ...(source.links ?? []), ...linksInText(source.text)]
}

function isSocialUrl(value: string) {
  return hostedBy(value, SOCIAL_HOSTS)
}

/** Web propia scrapeable: ni Instagram ni otra red, ni reservas ni agregador de links. */
function isOwnWebsite(url: string, reservationHosts: readonly string[]) {
  return !instagramProfileUrl(url) && !hostedBy(url, reservationHosts) && !isSocialUrl(url) && !hostedBy(url, LINK_AGGREGATOR_HOSTS)
}

/** Home de la primera URL cuyo dominio lleva el nombre de la marca (no directorios, redes ni reservas). */
/**
 * La web oficial entre URLs que trajo otra fuente (Exa, los links del Instagram validado): la primera con la marca en
 * el dominio o, si ninguna la tiene, la que coincide con la web que Google tiene para el lugar. La de Google sólo
 * confirma: nunca se devuelve una URL que no esté en `urls`.
 */
export function brandWebsite(urls: string[], brand: string, reservationHosts: readonly string[] = DEFAULT_RESERVATION_HOSTS, googleWebsite: string | null = null): string | null {
  const own = urls.filter((url) => isOwnWebsite(url, reservationHosts))
  const named = own.find((url) => classifySource(url, { name: brand }) === 'web')
  const googleHost = googleWebsite && !isSocialUrl(googleWebsite) ? hostname(googleWebsite) : ''
  const confirmed = named ?? (googleHost ? own.find((url) => hostname(url) === googleHost) : undefined)
  return confirmed ? `https://${new URL(confirmed).host}/` : null
}

/** Home (https://dominio/) de la web oficial scrapeada; null si no hay o si es red social, reservas o agregador. */
export function officialWebsiteHome(sources: Source[]): string | null {
  for (const source of sources) {
    if (source.kind !== 'web' || source.trust !== 'official') continue
    if (isSocialUrl(source.url) || hostedBy(source.url, DEFAULT_RESERVATION_HOSTS) || hostedBy(source.url, LINK_AGGREGATOR_HOSTS)) continue
    try {
      return `https://${new URL(source.url).host}/`
    } catch {
      continue
    }
  }
  return null
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

/** Primer teléfono uruguayo que aparece en el texto o los links de las fuentes. */
function firstSourcePhone(sources: Source[]): string | null {
  return sources
    // De los links, sólo tel: y WhatsApp: cualquier otra URL puede tener dígitos que no son un teléfono.
    .flatMap((source) => [...phonesInText(source.text), ...sourceLinks(source).filter((link) => /^tel:/i.test(link) || whatsappNumber(link) !== link).map(whatsappNumber)])
    .map(normalizeUruguayPhone)
    .find((value): value is string => Boolean(value)) ?? null
}

function phonesInText(value: string): string[] {
  return findPhoneNumbersInText(value, 'UY')
    .filter(({ number }) => isUruguayPhone(number))
    .map(({ number }) => number.number)
}

/**
 * Contacto que sale directo del texto y los links de las fuentes. Nada de Google: su web y su
 * teléfono no se guardan. La marca (nombre de Google sin sucursal) sólo se usa para elegir entre handles de Instagram.
 */
export function resolveDeterministicContact(
  details: GooglePlaceDetailsResponse,
  sources: Source[],
  reservationHosts: readonly string[] = DEFAULT_RESERVATION_HOSTS,
): DeterministicContact {
  const reservationUrl = sources
    .flatMap(sourceLinks)
    .map(httpsUrl)
    .find((url): url is string => Boolean(url && hostedBy(url, reservationHosts))) ?? null
  const phone = firstSourcePhone(sources)
  const instagram = preferredInstagramHandle(brandFromGoogleName(details.anchor.name), sources)
  return {
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
  context: { sources?: Source[]; seedCategories?: CategoryId[]; categoryFallback?: string[]; deterministicContact?: DeterministicContact; prominenceSignals?: ProminenceSourceSignals } = {},
): PlaceEnrichmentDraft {
  const sources = context.sources ?? []
  const sourcesById = new Map(sources.map((source) => [source.id, source]))
  const result = { ...structuredClone(data), contact: contactFromModel(data.contact) }

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

  // Cadenas: horario, teléfono, dirección y features físicos sólo si todas sus fuentes hablan de
  // esta sucursal (dirección o barrio). Web, Instagram, categorías, platos, descripción, dieta y precio son de la marca.
  const chain = isChainBranch(target, sources)
  const branchFact = (fact: ValidFact) => mentionsBranch(fact.source, target)
  const branchOnly = (field: string) => {
    const cited = (support.get(field) ?? []).map((id) => factsById.get(id)!)
    return !chain || (cited.length > 0 && cited.every(branchFact))
  }

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
  // Facts que arma el código desde el texto de una fuente (ids C1, C2…), para que el tag tenga respaldo auditable.
  const addCodeFact = (field: string, text: string, source: Source) => {
    let index = 1
    while (factsById.has(`C${index}`)) index += 1
    const fact: ValidFact = { id: `C${index}`, text: text.trim().slice(0, 200), kind: 'feature', source }
    facts.push(fact)
    factsById.set(fact.id, fact)
    support.set(field, [...(support.get(field) ?? []), fact.id])
  }
  // Un tag que el modelo sólo respaldó con el resumen de Exa se queda si una fuente real (web,
  // Instagram, páginas de Exa) lo nombra: la línea que lo nombra pasa a ser su respaldo.
  const backedBySourceText = (id: string, field: string) => {
    for (const source of sources) {
      if (source.url === EXA_SUMMARY_URL) continue
      const line = source.text.split(/\n|(?<=\.)\s/).find((part) => tagMentioned(id, [part]))
      if (!line) continue
      addCodeFact(field, line, source)
      return true
    }
    return false
  }
  // Respaldo de momentos, cozy y style, para auditar si salió de la fuente o de señales.
  const tagEvidence: TagEvidence[] = []
  const lastSupport = (field: string) => (support.get(field) ?? []).slice(-1)
  // Explícito: el fact nombra el tag y su fuente también (no alcanza con la paráfrasis del modelo en el fact).
  const explicitEvidence = (id: string, eligible: ValidFact[]): TagEvidence | null => {
    for (const fact of eligible) {
      const phrase = tagMention(id, [fact.text])
      if (phrase && tagMentioned(id, [fact.source.text])) return { tag: id, mode: 'explicit', signals: [phrase], factIds: [fact.id] }
    }
    return null
  }
  // Sin facts fuera del resumen de Exa: vale si una fuente real lo nombra (la línea pasa a ser su respaldo).
  const sourceTextEvidence = (id: string, field: string): TagEvidence | null =>
    backedBySourceText(id, field) ? { tag: id, mode: 'explicit', signals: [tagMention(id, sources.map((source) => source.text)) ?? id], factIds: lastSupport(field) } : null
  // Facts citados en un campo que salen del resumen de Exa: sus señales cuentan como débiles.
  const summaryFacts = (field: string) => (support.get(field) ?? []).map((factId) => factsById.get(factId)!).filter((fact) => fact.source.url === EXA_SUMMARY_URL)
  const inferredEvidence = (id: string, signals: SignalMatch[]): TagEvidence => ({
    tag: id,
    mode: 'inferred',
    signals: signals.map((match) => match.fromSummary ? `${match.signal} (resumen de Exa)` : match.signal),
    factIds: [...new Set(signals.map((match) => match.factId))],
  })
  // Un momento: lo nombra la fuente, o hay una señal fuerte o dos débiles en los facts citados (el resumen de Exa
  // aporta sólo débiles y nunca alcanza solo).
  const momentEvidence = (id: string, field: string, eligible: ValidFact[]): TagEvidence | null => {
    const explicit = explicitEvidence(id, eligible)
    if (explicit) return explicit
    const signals = isMomentId(id) ? sufficientSignals(signalsIn(MOMENT_SIGNALS[id], eligible), signalsIn(MOMENT_SIGNALS[id], summaryFacts(field))) : null
    if (signals) return inferredEvidence(id, signals)
    return eligible.length === 0 ? sourceTextEvidence(id, field) : null
  }
  // cozy no distingue nada si se deduce: sólo si la fuente dice acogedor o cozy.
  const cozyEvidence = (field: string, eligible: ValidFact[]) =>
    eligible.length === 0 ? sourceTextEvidence('cozy', field) : explicitEvidence('cozy', eligible)
  const gated = (evidence: TagEvidence | null) => {
    if (evidence) tagEvidence.push(evidence)
    return evidence !== null
  }

  for (const seedCategory of context.seedCategories ?? []) addUnique(categories, seedCategory)
  // Una cocina del modelo necesita respaldo en los facts (la nombran o dos platos típicos); reviewExtraction anota las descartadas.
  const cuisineEvidence = supportedCuisines(retainTags<TagId>('cuisines'), facts)
  const tags: TagId[] = [...new Set<TagId>([
    // late_night jamás se toma del modelo: depende exclusivamente de los horarios.
    ...retainTags<TagId>('moments').filter((moment) => moment !== 'late_night'),
    ...LLM_TAG_GROUPS.filter((group) => group !== 'moments').flatMap((group) => retainTags<TagId>(group)),
  ].filter((id) => groupOf(id) !== 'cuisines' || cuisineEvidence.has(id))
  // FEATURES, GOOD_FOR, OFFERS y ATMOSPHERE necesitan un fact que no sea del resumen de Exa; FEATURES,
  // GOOD_FOR y ATMOSPHERE, además, uno de esos facts tiene que nombrar el tag (label o sinónimo).
    .filter((id) => {
      const group = groupOf(id)
      if (!group || !NOT_FROM_EXA_SUMMARY_GROUPS.has(group)) return true
      const field = `${group}.${id}`
      const eligible = (support.get(field) ?? []).map((factId) => factsById.get(factId)!).filter((fact) => fact.source.url !== EXA_SUMMARY_URL)
      if (group === 'goodFor' && isMomentId(id)) return gated(momentEvidence(id, field, eligible))
      if (id === 'cozy') return gated(cozyEvidence(field, eligible))
      if (eligible.length === 0) return backedBySourceText(id, field)
      return !MENTION_REQUIRED_GROUPS.has(group) || tagMentioned(id, eligible.map((fact) => fact.text))
    })
  // En una cadena, un feature físico necesita un fact de una fuente que hable de esta sucursal.
    .filter((id) => !chain || !BRANCH_FEATURES.has(id) || (support.get(`features.${id}`) ?? []).some((factId) => branchFact(factsById.get(factId)!))))]
  // Un espacio para niños hace al lugar apto niños: el fact de kids_area es su respaldo.
  if (tags.includes('kids_area') && !tags.includes('kids_friendly')) {
    const factIds = support.get('features.kids_area') ?? []
    tags.push('kids_friendly')
    support.set('goodFor.kids_friendly', [...new Set([...(support.get('goodFor.kids_friendly') ?? []), ...factIds])])
    tagEvidence.push({ tag: 'kids_friendly', mode: 'inferred', signals: ['espacio para niños (kids_area)'], factIds })
  }
  // Una picada (o tabla) es para compartir aunque la fuente no lo diga: hace al lugar para grupos.
  if (tags.includes('picada') && !tags.includes('groups')) {
    const factIds = support.get('foods.picada') ?? []
    tags.push('groups')
    support.set('goodFor.groups', [...new Set([...(support.get('goodFor.groups') ?? []), ...factIds])])
    tagEvidence.push({ tag: 'groups', mode: 'inferred', signals: ['picada (tag)'], factIds })
  }
  // Momentos que el modelo no propuso: el código los deduce de las señales en todos los facts, con las mismas reglas
  // (una fuerte o dos débiles; el resumen de Exa sólo suma como débil), sin las señales de NOT_FOR_DEDUCTION.
  // Uno que el modelo propuso y se descartó no vuelve por acá.
  const proposedMoments = new Set(result.tags.filter((item) => item.group === 'goodFor').map((item) => item.id))
  const ownFacts = facts.filter((fact) => fact.source.url !== EXA_SUMMARY_URL)
  const exaFacts = facts.filter((fact) => fact.source.url === EXA_SUMMARY_URL)
  for (const id of MOMENT_IDS) {
    if (tags.includes(id) || proposedMoments.has(id)) continue
    const skipped = new Set(NOT_FOR_DEDUCTION[id] ?? [])
    const candidates = MOMENT_SIGNALS[id].filter((signal) => !skipped.has(signal.id))
    const signals = sufficientSignals(signalsIn(candidates, ownFacts), signalsIn(candidates, exaFacts))
    if (!signals) continue
    tags.push(id)
    support.set(`goodFor.${id}`, [...new Set(signals.map((match) => match.factId))])
    tagEvidence.push(inferredEvidence(id, signals))
  }
  // style: uno solo, de la marca. casual y cuidado necesitan una señal en un fact citado (fuera del resumen de
  // Exa); intermedio, algún fact. Sin eso queda null, nunca baja a intermedio.
  const styleIds = [...new Set(result.tags.filter((item) => item.group === 'style' && isStyleId(item.id)).map((item) => item.id as StyleId))]
  let style: StyleId | null = null
  if (styleIds.length === 1) {
    const id = styleIds[0]
    const field = `style.${id}`
    const eligible = (support.get(field) ?? []).map((factId) => factsById.get(factId)!).filter((fact) => fact.source.url !== EXA_SUMMARY_URL)
    const signals = id === 'intermedio' ? null : sufficientSignals(signalsIn(STYLE_SIGNALS[id], eligible), signalsIn(STYLE_SIGNALS[id], summaryFacts(field)))
    if (signals) {
      style = id
      tagEvidence.push({ ...inferredEvidence(id, signals), basis: 'signals' })
    } else if (id === 'intermedio' && eligible.length > 0) {
      style = id
      tagEvidence.push({ tag: id, mode: 'inferred', basis: 'signals', signals: [], factIds: eligible.map((fact) => fact.id) })
    }
  }
  // Un style descartado no deja sus facts como si respaldaran algo.
  for (const id of styleIds) if (id !== style) support.delete(`style.${id}`)
  // Sin style del modelo: si los facts (fuera del resumen de Exa) traen señales de un solo estilo, es ese.
  if (styleIds.length === 0) {
    const found = (['casual', 'cuidado'] as const).flatMap((id) => {
      const signals = sufficientSignals(signalsIn(STYLE_SIGNALS[id], ownFacts), signalsIn(STYLE_SIGNALS[id], exaFacts))
      return signals ? [{ id, signals }] : []
    })
    if (found.length === 1) {
      const [{ id, signals }] = found
      const factIds = [...new Set(signals.map((match) => match.factId))]
      style = id
      support.set(`style.${id}`, factIds)
      tagEvidence.push({ ...inferredEvidence(id, signals), basis: 'signals' })
    }
  }
  // Un highlight tiene que citar un fact válido y aparecer en alguna fuente, en español o en inglés.
  const highlights = result.highlights
    .filter((highlight) => validCitations(highlight.facts).length > 0 &&
      sources.some((source) => hasPhrase(source.text, highlight.es) || hasPhrase(source.text, highlight.en)))
    .map(({ es, en }) => ({ es, en }))
    .slice(0, MAX_HIGHLIGHTS)
  // Un plato queda si un mismo fact válido lo respalda; se guarda en minúscula y sin repetir.
  const seenDishes = new Set<string>()
  const dishes = result.dishes.flatMap((raw) => {
    const dish = raw.trim().replace(/\s+/g, ' ').toLowerCase()
    const key = dishWords(dish).join(' ')
    if (!key || seenDishes.has(key) || !facts.some((fact) => dishSupportedBy(dish, fact.text))) return []
    seenDishes.add(key)
    return [dish]
  }).slice(0, MAX_DISHES)

  // Horarios: el modelo interpreta, el código valida bloques y decide la confianza por la fuente del fact.
  const hoursFacts = branchOnly('hours') ? (support.get('hours') ?? []).map((id) => factsById.get(id)!).filter(Boolean) : []
  const slots = hoursFacts.length > 0 ? slotsFromBlocks(result.hours.blocks) : []
  const raw = hoursFacts.length > 0 ? result.hours.raw?.trim() || null : null
  const hoursSource: SourceTrust | null = slots.length > 0 || raw
    ? hoursFacts.some((fact) => fact.source.trust === 'official') ? 'official' : 'third_party'
    : null

  // Nombre: la marca (nombre de Google sin sucursal) si alguna fuente la nombra; el resumen de Exa
  // no cuenta porque sale de una búsqueda con ese nombre. Si no, el del modelo con su support.
  const brand = brandFromGoogleName(target.name)
  const brandConfirmed = sources.some((source) => source.url !== EXA_SUMMARY_URL && hasPhrase(source.text, brand))
  // Nombre del modelo y dirección: con support y escritos tal cual en alguna fuente citada. Nunca los de Google.
  const sourcedText = (field: 'name' | 'address') => {
    const value = result[field].trim()
    const citedSources = (support.get(field) ?? []).map((id) => factsById.get(id)!.source)
    return value && citedSources.some((source) => hasPhrase(source.text, value)) ? value : null
  }

  // En una cadena la dirección además tiene que ser la de esta sucursal, no la de otra de la misma fuente.
  const address = sourcedText('address')
  const processed: ProcessedExtraction = {
    name: brandConfirmed ? brand : sourcedText('name') ?? '',
    address: address && branchOnly('address') && (!chain || mentionsAddress(address, target.address)) ? address : null,
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
  // style nunca queda vacío: sin señales, sale del precio y, sin precio, del ícono.
  if (!style) {
    const fallback = fallbackStyle(processed.price, result.iconCategory)
    style = fallback.style
    tagEvidence.push({ ...fallback.evidence, factIds: fallback.evidence.basis === 'price' ? support.get('price') ?? [] : [] })
  }
  for (const field of ['phone', 'whatsapp', 'instagram', 'website', 'menuUrl', 'reservationUrl'] as const) {
    if (processed.contact[field] && !supported(`contact.${field}`)) processed.contact[field] = null
  }
  for (const field of ['phone', 'whatsapp'] as const) {
    if (processed.contact[field] && !branchOnly(`contact.${field}`)) processed.contact[field] = null
  }

  processed.contact = normalizeContact(processed.contact)
  if (context.deterministicContact) {
    // El teléfono del modelo, con su support, gana; el que aparece en el texto de las fuentes es respaldo.
    // En una cadena, el teléfono de respaldo sólo de fuentes que hablan de esta sucursal.
    const { phone: anyPhone, ...deterministic } = context.deterministicContact
    const phone = chain ? firstSourcePhone(sources.filter((source) => mentionsBranch(source, target))) : anyPhone
    processed.contact = normalizeContact({ ...processed.contact, ...deterministic, phone: processed.contact.phone ?? phone ?? null })
  }
  // El Instagram validado por Apify no queda si el modelo lo rechazó (vio que es de otro negocio).
  const instagramRejected = Boolean(processed.contact.instagram && instagramRejectedByModel(data, processed.contact.instagram))
  if (instagramRejected) processed.contact.instagram = null
  // La web que el modelo respalda con un fact gana; si no hay, la home de la web oficial scrapeada.
  processed.contact.website ??= officialWebsiteHome(sources)
  if (processed.contact.reservationUrl && (processed.reservations === 'unknown' || processed.reservations === 'no_reservations')) {
    processed.reservations = 'accepts'
  }

  // Delivery: la página del local (nombra la marca) en Rappi o PedidosYa alcanza, aunque ningún fact lo diga.
  const deliveryPage = sources.find((source) => hostedBy(source.url, DELIVERY_HOSTS) && hasPhrase(source.text, brand))
  if (deliveryPage && !processed.tags.includes('delivery')) {
    processed.tags.push('delivery')
    addCodeFact('features.delivery', `Tiene página de pedidos en ${hostname(deliveryPage.url)}`, deliveryPage)
  }

  applyConsistencyRules(processed)
  processed.tags = capCuisines(processed.tags)
  // signature: ids que quedaron en tags, sin repetir y hasta 3. El resto se descarta.
  const finalTags = new Set<string>(processed.tags)
  const signature = [...new Set(result.signature.map((id) => id.trim()))]
    .filter((id): id is TagId => finalTags.has(id) && signatureAllowed(id, processed.name, processed.description.es))
    .slice(0, MAX_SIGNATURE)
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
    missingReason: slots.length > 0 ? null : chain ? 'chain_branch_not_found' as const : 'no_data' as const,
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

  const searchInput = searchTextInput({ ...processed, neighborhoodId: target.neighborhoodId, dishes, signature, style })
  // En una sucursal de cadena los seguidores son de la marca: quedan, y computeProminence los descuenta.
  const prominence = context.prominenceSignals ?? NO_PROMINENCE_SIGNALS
  const signals = { igFollowers: instagramRejected ? null : prominence.instagramFollowers, chainBranch: chain }
  return PlaceDraft.parse({
    ...target,
    ...processed,
    // De la marca, como las categorías: no depende de la sucursal ni lleva support.
    iconCategory: result.iconCategory,
    style,
    // Las cocinas que entraron por platos muestran cuáles; las que nombra un fact ya se ven en sus facts.
    tagEvidence: [
      ...tagEvidence,
      ...[...cuisineEvidence.values()].filter((evidence) => evidence.mode === 'inferred' && processed.tags.includes(evidence.tag as TagId)),
    ],
    hours: normalizedHours,
    dishes,
    signature,
    placeFacts,
    signals,
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
// Features que dependen del local físico: en una cadena varían de una sucursal a otra.
const BRANCH_FEATURES = new Set<string>(['terrace', 'sidewalk', 'patio', 'sea_view', 'kids_area', 'accessible', 'pool_table'])
const MULTI_BRANCH_TEXT = /\b(?:sucursales|nuestros locales|nuestras tiendas|todos los locales|otros locales|otras sucursales)\b/
const MULTI_BRANCH_PATH = /\/(?:store|stores|locales|sucursales|tiendas)\//

/**
 * Sucursal de una cadena: el nombre de Google trae una sucursal (no un agregado descriptivo) o alguna
 * fuente muestra varias sucursales.
 */
export function isChainBranch(target: Pick<Target, 'name'>, sources: Source[]): boolean {
  if (googleNameParts(target.name).branch) return true
  return sources.some((source) => {
    let path = ''
    try { path = new URL(source.url).pathname.toLowerCase() } catch { /* URL inválida: sólo el texto */ }
    return MULTI_BRANCH_TEXT.test(canonical(source.text)) || MULTI_BRANCH_PATH.test(path)
  })
}

/**
 * La fuente habla de esta sucursal: menciona su dirección o su barrio. El resumen de Exa no
 * cuenta: en una cadena junta datos de varias sucursales.
 */
export function mentionsBranch(source: Source, target: Pick<Target, 'address' | 'neighborhoodId'>): boolean {
  if (source.url === EXA_SUMMARY_URL) return false
  const neighborhood = neighborhoodDisplayName(target.neighborhoodId ?? null)
  return mentionsAddress(source.text, target.address) || Boolean(neighborhood && hasPhrase(source.text, neighborhood))
}

const INSTAGRAM_REJECTED_PREFIX = /^instagram rechazado:/i

/**
 * El modelo rechazó el Instagram validado: lo dice en doubts con «Instagram rechazado:», o deja
 * contact.instagram vacío y nombra el handle en doubts (por qué no lo usó).
 */
export function instagramRejectedByModel(data: Pick<PlaceExtraction, 'doubts' | 'contact'>, handle: string | null): boolean {
  if (data.doubts.some((doubt) => INSTAGRAM_REJECTED_PREFIX.test(doubt.trim()))) return true
  if (!handle || data.contact.instagram?.trim()) return false
  const needle = handle.toLowerCase()
  return data.doubts.some((doubt) => doubt.toLowerCase().includes(needle))
}

export function mentionsAddress(text: string, address: string): boolean {
  const street = canonical(address.split(',')[0] ?? '')
  const haystack = ` ${canonical(text).replace(/[^a-z0-9]+/g, ' ')} `
  const number = street.match(/\b\d{2,5}\b/)?.[0]
  if (number) return haystack.includes(` ${number} `)
  const words = street.split(/[^a-z0-9]+/).filter((word) => word.length >= 4)
  return words.length > 0 && words.every((word) => haystack.includes(` ${word} `))
}

const MAX_DOUBTS = 5
export const MISSING_NAME_DOUBT = 'Nombre: ninguna fuente confirma el nombre del local; no se puede guardar.'
const DAY_LABELS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

/**
 * Lo que el pipeline no resolvió en un lugar, para el reporte del lote. No modifica el borrador.
 * Un fact queda sin mapear si ningún tag, campo, horario ni highlight conservado lo cita.
 */
export function reviewExtraction(
  place: PlaceEnrichmentDraft,
  data: PlaceExtraction,
  hoursRetry: PlaceReview['hoursRetry'] = { attempted: false, recovered: false, costUsd: 0 },
  logo: PlaceReview['logo'] = NO_LOGO.review,
  rateLimits: NonNullable<PlaceReview['rateLimits']> = [],
  instagramFallback: PlaceReview['instagramFallback'] = undefined,
  instagramTieBreak: PlaceReview['instagramTieBreak'] = undefined,
  instagramShared: PlaceReview['instagramShared'] = undefined,
): PlaceReview {
  const keptHighlights = new Set(place.highlights.map((highlight) => highlight.es))
  const citedByHighlights = new Set(data.highlights
    .filter((highlight) => keptHighlights.has(highlight.es))
    .flatMap((highlight) => highlight.facts.map((id) => id.trim())))
  const proposedTags = new Map(data.facts.map((fact) => [fact.id.trim(), proposedTagFrom(fact.proposedTag)]))
  const unmappedFacts = place.placeFacts
    .filter((fact) => fact.supports.length === 0 && !citedByHighlights.has(fact.id))
    .map(({ id, text }) => ({ id, text, proposedTag: proposedTags.get(id) ?? null }))

  // Sin nombre de las fuentes el lugar no se puede guardar: el aviso va primero para que el tope no lo corte.
  const doubts = [...new Set([
    ...(place.name.trim() ? [] : [MISSING_NAME_DOUBT]),
    ...data.doubts.map((doubt) => doubt.trim()).filter(Boolean),
  ])].slice(0, MAX_DOUBTS)

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
  // Cocinas que el modelo propuso (por tag o proposedTag) y que postProcess descartó porque ningún fact las nombra.
  const proposedCuisines = [
    ...data.tags.filter((item) => item.group === 'cuisines').map((item) => item.id.trim()),
    ...data.facts.map((fact) => fact.proposedTag?.trim() ?? '').filter((id) => groupOf(id) === 'cuisines'),
  ]
  const supported = supportedCuisines([...new Set(proposedCuisines)], place.placeFacts)
  const unmentioned = [...new Set(proposedCuisines)]
    .filter((id) => Object.hasOwn(CUISINES, id) && !tags.includes(id) && !supported.has(id))
  if (unmentioned.length > 0) anomalies.push({ type: 'cuisine_unmentioned', detail: unmentioned.join(', ') })

  return {
    unmappedFacts, doubts, anomalies, hoursRetry, logo, rateLimits,
    ...(instagramFallback?.attempted || instagramFallback?.skipped ? { instagramFallback } : {}),
    ...(instagramTieBreak ? { instagramTieBreak } : {}),
    ...(instagramShared?.length ? { instagramShared } : {}),
  }
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
    : source?.kind === 'exa' && source.url === EXA_SUMMARY_URL
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
  logo: { model: string; usage: LlmUsage } | null = null,
): PlaceExtractionCost {
  const googleCost = usage.googleRequests * rates.googleDetailsRequestUsd
  const exaCost = usage.exaRequests * rates.exaSearchRequestUsd + usage.exaContentPages * rates.exaContentPageUsd +
    usage.exaHighlightPages * rates.exaHighlightPageUsd
  const instagramCost = usage.instagramRequests * rates.instagramRunUsd + (usage.instagramSearchResults ?? 0) * rates.instagramSearchResultUsd
  const scrapingCost = usage.scrapingRequests * rates.scrapingRequestUsd
  const transitCost = usage.transitRequests * rates.transitRequestUsd
  const price = llm ? llmPrice(model) : null
  const { inputCost, outputCost } = llmUsageCost(model, llm)
  const llmCost = inputCost + outputCost
  const hoursRetryCost = hoursRetry ? llmUsageCost(hoursRetry.model, hoursRetry.usage) : null
  const hoursRetryUsd = hoursRetryCost ? hoursRetryCost.inputCost + hoursRetryCost.outputCost : 0
  const logoCost = logo ? llmUsageCost(logo.model, logo.usage) : null
  const logoUsd = logoCost ? logoCost.inputCost + logoCost.outputCost : 0

  return {
    currency: 'USD',
    // Las tarifas de Google y Exa son de lista; el LLM es real si hay precio y uso.
    estimated: !(price && llm?.inputTokens !== null && llm?.outputTokens !== null),
    totalUsd: roundUsd(googleCost + exaCost + instagramCost + scrapingCost + transitCost + llmCost + hoursRetryUsd + logoUsd),
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
      ...(logo ? {
        logo: {
          model: logo.model,
          inputTokens: logo.usage.inputTokens,
          outputTokens: logo.usage.outputTokens,
          gatewayCostUsd: logo.usage.gatewayCostUsd,
          costUsd: roundUsd(logoUsd),
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
  /** Búsqueda de respaldo del Instagram (sólo si la primera pasada no dejó candidatos). */
  instagramFallback?: NonNullable<PlaceReview['instagramFallback']>
  /** Señales de actividad del Instagram validado (null sin Instagram): si está funcionando, no va a not_open_yet. */
  instagramActivity?: InstagramActivity | null
  /** Handles descartados por ser de un lugar de otra marca, con esos lugares: el contacto no puede quedar con uno de ellos. */
  sharedInstagram?: NonNullable<PlaceReview['instagramShared']>
  /** Desempate entre perfiles válidos (el del respaldo, si hubo, pisa al de la primera pasada). */
  instagramTieBreak?: NonNullable<PlaceReview['instagramTieBreak']>
  /** Seguidores del Instagram validado; postProcess decide igFollowers (null en cadenas). */
  prominenceSignals?: ProminenceSourceSignals
  /** Paso del logo, desde la foto de perfil del Instagram validado. */
  logo?: LogoOutcome
  /** 429 de esta etapa; extractFrom sigue sumando los suyos. Falta si las fuentes vienen de un JSON. */
  rateLimits?: RateLimitLog
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
  private readonly logoStorage?: LogoStore
  private readonly classifyLogo: LogoClassifier
  private readonly logoModel: string
  private readonly logoFetcher?: typeof fetch
  private readonly rateLimitRetry: RateLimitRetryOptions
  private readonly snapshots?: ExtractionSnapshotStore
  private readonly candidateRegistry: Pick<InstagramCandidateRegistry, 'claim'>
  private readonly instagramOwners?: InstagramOwners

  constructor(config: { apiKey?: string; details: DetailsProvider; exa?: ExaPlaceProvider; instagram?: InstagramProvider; website?: WebsiteProvider; transit?: TransitProvider; generate?: GenerateExtraction; generateHours?: GenerateHours; costRates?: Partial<ExtractionCostRates>; reservationHosts?: readonly string[]; model?: ExtractionModelConfig; hoursModel?: ExtractionModelConfig; logoStorage?: LogoStore; classifyLogo?: LogoClassifier; logoModel?: string; logoFetcher?: typeof fetch; rateLimitRetry?: RateLimitRetryOptions; snapshots?: ExtractionSnapshotStore; candidateRegistry?: Pick<InstagramCandidateRegistry, 'claim'>; instagramOwners?: InstagramOwners }) {
    this.configured = Boolean(config.apiKey?.trim())
    this.details = config.details
    this.exa = config.exa
    this.instagram = config.instagram
    this.website = config.website
    this.transit = config.transit
    this.snapshots = config.snapshots
    this.generate = config.generate ?? generatePlaceExtraction
    this.generateHours = config.generateHours ?? generateHoursRetry
    this.costRates = extractionCostRates(config.costRates)
    this.reservationHosts = config.reservationHosts ?? DEFAULT_RESERVATION_HOSTS
    this.modelConfig = config.model ?? extractionModelConfig()
    this.hoursModel = config.hoursModel ?? hoursModelConfig()
    this.logoStorage = config.logoStorage
    this.classifyLogo = config.classifyLogo ?? classifyLogo
    this.logoModel = config.logoModel ?? logoModel()
    this.logoFetcher = config.logoFetcher
    this.rateLimitRetry = config.rateLimitRetry ?? {}
    this.candidateRegistry = config.candidateRegistry ?? new InstagramCandidateRegistry()
    this.instagramOwners = config.instagramOwners
  }

  /**
   * Candidatos de la primera pasada que ya son de un lugar de otra marca: candidatos de otro lugar en este server
   * (registro) o guardados en la base para otro lugar. Anota los candidatos de este lugar. Si la base falla, sólo
   * el registro.
   */
  private async sharedInstagram(placeId: string, brand: string, candidates: string[]): Promise<SharedInstagram> {
    const handles = candidates.map(instagramHandle).filter((handle): handle is string => Boolean(handle))
    const shared = this.candidateRegistry.claim(placeId, brand, handles)
    if (!this.instagramOwners || handles.length === 0) return shared
    const owners = await this.instagramOwners(handles, placeId).catch((error: unknown) => {
      console.warn(JSON.stringify({ event: 'instagram_owners_failed', placeId, error: String(error) }))
      return []
    })
    const key = brandKey(brand)
    for (const owner of owners) {
      if (key && brandKey(owner.name) === key) continue
      shared.set(owner.handle, [...new Set([...(shared.get(owner.handle) ?? []), owner.googlePlaceId])])
    }
    return shared
  }

  /**
   * Cupo del servicio con reintentos ante 429 (y, en Apify, ante timeouts y errores pasajeros); la espera
   * entre intentos libera el cupo.
   */
  private limited<T>(service: LimitedService, log: RateLimitLog, operation: () => Promise<T>): Promise<T> {
    const transientDelaysMs = service === 'apify' ? this.rateLimitRetry.transientDelaysMs ?? APIFY_TRANSIENT_DELAYS_MS : []
    return withRateLimitRetry(service, () => withServiceLimit(service, operation), log, { ...this.rateLimitRetry, transientDelaysMs })
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
    const rateLimits = new RateLimitLog(placeId)
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
      // El request no trae nombre: Exa busca con la marca (nombre de Google sin sucursal) y el tipo de
      // lugar de Google, para no mezclar homónimos; el provider agrega Montevideo. La búsqueda principal
      // suma el barrio si la marca es corta o genérica (placeSearchTerm).
      const searchTerm = (details: GooglePlaceDetailsResponse) => brandSearchTerm(brandFromGoogleName(details.anchor.name), details.placeType)
      const placeTerm = (details: GooglePlaceDetailsResponse) => placeSearchTerm(
        details.anchor.name,
        details.placeType,
        neighborhoodDisplayName(request.neighborhoodId ?? getNeighborhood(details.anchor.latitude, details.anchor.longitude).neighborhoodId),
      )
      const exaPromise = this.exa?.configured
        ? detailsPromise
          .then((details) => timed('exa', () => this.limited('exa', rateLimits, () => this.exa!.searchPlace(placeTerm(details)))))
          // Se espera más adelante: el error queda como valor para no dejar un rechazo sin manejar.
          .catch((error: unknown) => new ExaProviderFailure(error))
        : Promise.resolve(null)
      // Búsqueda dirigida a Instagram con la marca: sólo propone handles, que después valida Apify.
      const instagramSearchPromise = this.exa?.configured && this.exa.searchText
        ? detailsPromise
          .then((details) => timed('exaInstagram', () => this.limited('exa', rateLimits, () => this.exa!.searchText!(`${searchTerm(details)} Montevideo instagram`))))
          .catch((error: unknown) => new ExaProviderFailure(error))
        : Promise.resolve(null)
      const transitPromise = timed('transit', () => detailsPromise
        .then((details) => this.transit
          ? this.transit.findNearbyLines(details.anchor.latitude, details.anchor.longitude).catch(() => ({ status: 'unavailable' as const, lines: [] }))
          : ({ status: 'unavailable' as const, lines: [] }))
        .catch(() => ({ status: 'unavailable' as const, lines: [] })))
      const details = await detailsPromise
      costUsage.googleRequests = 1
      const { coordinates } = targetFromDetails(placeId, details, request, { status: 'unavailable', lines: [] })
      const scrapeWebsite = (url: string | null) => this.website?.configured && url
        ? timed('scraping', () => this.website!.scrape(url)).catch(() => null)
        : Promise.resolve(null)
      const brand = brandFromGoogleName(details.anchor.name)
      // La web de Google (websiteUri) no es fuente: sólo confirma una web o un Instagram que trajo otra fuente.
      const googleWebsite = details.websiteUri ?? null
      // Sin Exa el lugar no sigue (como con Apify): se reintenta en vez de guardarlo con menos fuentes.
      const exa = await exaPromise
      if (exa instanceof ExaProviderFailure) throw exa
      // La web oficial sale de los resultados de Exa (marca en el dominio, o la misma que tiene Google).
      let websiteUrl = exa ? brandWebsite(exa.results.map((result) => result.url), brand, this.reservationHosts, googleWebsite) : null
      const websitePromise = scrapeWebsite(websiteUrl)
      if (exa) {
        costUsage.exaRequests = 1
        costUsage.exaContentPages = exa.results.length
      }
      // Los links de la web oficial también proponen el Instagram, así que Instagram espera a la web.
      let website = await websitePromise
      const instagramSearch = await instagramSearchPromise
      if (instagramSearch instanceof ExaProviderFailure) throw instagramSearch
      if (instagramSearch) {
        costUsage.exaRequests += 1
        costUsage.exaHighlightPages += instagramSearch.results.length
      }
      const directedHandles = instagramSearch ? instagramHandlesFromResults(instagramSearch.results) : []
      const origins = instagramCandidateOrigins(exa, website ? [...website.instagramUrls, ...(website.links ?? [])] : [], directedHandles)
      let candidates = [...origins.keys()]
      // Cuentas agregadoras: candidatas de otro lugar. Se descartan sin pedirlas a Apify.
      const shared = await this.sharedInstagram(placeId, details.anchor.name, candidates)
      const sharedDecisions: InstagramAuditCandidate[] = [...shared.keys()].map((handle) => ({ handle, decision: 'discarded', reason: 'shared_with_other_place' }))
      const ownCandidates = candidates.filter((candidate) => !shared.has(instagramHandle(candidate) ?? ''))
      const instagramFallback: NonNullable<PlaceReview['instagramFallback']> = { attempted: false, reason: '', terms: [], handles: [], costUsd: 0 }
      let firstPass: InstagramValidation | null = null
      // Desempate por foto de perfil: la misma detección del avatar genérico que el logo, con su fetcher.
      const pictureStatus: PictureStatus = (profile) => profilePictureStatus(profile.profilePicUrl, this.logoFetcher)
      // Cuentas personales: la foto de los aceptados sin señales de negocio se clasifica con el modelo del logo, una
      // vez por perfil aunque aparezca en las dos pasadas. El logo reusa la del elegido.
      const pictureClassifications = new Map<string, Promise<PictureClassification | null>>()
      const classifyPicture = (profile: InstagramProfileData) => {
        const key = instagramProfileUrl(profile.url) ?? profile.url
        if (!pictureClassifications.has(key)) {
          pictureClassifications.set(key, classifyProfilePicture(profile.profilePicUrl, {
            classify: (image, model) => this.limited('llm', rateLimits, () => this.classifyLogo(image, model)),
            model: this.logoModel,
            fetcher: this.logoFetcher,
          }))
        }
        return pictureClassifications.get(key)!
      }
      const pictureKind: PictureKind = async (profile) => (await classifyPicture(profile))?.kind ?? null
      let fallbackValidation: InstagramValidation | null = null
      if (ownCandidates.length > 0) {
        if (this.instagram?.configured) costUsage.instagramRequests = 1
        firstPass = await timed('instagram', () => validatedInstagram(this.instagram, details, ownCandidates, websiteUrl, (operation) => this.limited('apify', rateLimits, operation), pictureStatus, pictureKind))
      }
      if (sharedDecisions.length > 0) firstPass = { ...(firstPass ?? { profile: null }), candidates: [...sharedDecisions, ...(firstPass?.candidates ?? [])] }
      let instagramValidation: InstagramValidation = firstPass ?? { profile: null, candidates: [] }
      const fallbackReason = instagramFallbackReason(candidates, firstPass)
      const canSearch = Boolean(fallbackReason && this.instagram?.configured && this.instagram.searchProfiles)
      if (canSearch && !brandNamedInSources(brand, website, exa)) {
        // Sin nombre confirmado la marca no está respaldada: no se busca (la primera pasada queda como está).
        Object.assign(instagramFallback, { skipped: 'unconfirmed_name', reason: fallbackReason })
      } else if (canSearch && fallbackReason) {
        // Respaldo: sin candidatos o con los de la primera pasada rechazados. Busca la marca en Instagram con Apify.
        const searched = await timed('instagramSearch', () => searchedInstagram(this.instagram!, details, brand, websiteUrl, (operation) => this.limited('apify', rateLimits, operation), ownCandidates, new Set(shared.keys()), pictureStatus, pictureKind))
        fallbackValidation = searched.validation
        candidates = [...new Set([...candidates, ...searched.candidates])]
        for (const url of searched.candidates) origins.set(url, [...new Set([...(origins.get(url) ?? []), 'apify_search' as const])])
        instagramValidation = mergedInstagramValidation(firstPass, searched.validation)
        costUsage.instagramSearchResults = searched.chargedResults
        Object.assign(instagramFallback, {
          attempted: true,
          reason: fallbackReason,
          terms: searched.terms,
          handles: searched.candidates.map(instagramHandle).filter((handle): handle is string => Boolean(handle)),
          costUsd: roundUsd(searched.chargedResults * this.costRates.instagramSearchResultUsd),
          ...(searched.validation.tieBreak ? { tieBreak: searched.validation.tieBreak } : {}),
        })
      }
      const tied = fallbackValidation?.tieBreak ? { validation: fallbackValidation, pass: 'fallback' as const }
        : firstPass?.tieBreak ? { validation: firstPass, pass: 'first' as const } : null
      const instagramTieBreak: CollectedSources['instagramTieBreak'] = tied
        ? { rule: tied.validation.tieBreak!, pass: tied.pass, handles: tied.validation.tieHandles ?? [] }
        : undefined
      // Auditoría: de dónde salió cada handle (queda en el snapshot y en sourceAudit).
      instagramValidation = { ...instagramValidation, candidates: withOrigins(instagramValidation.candidates, origins) }
      const profile = instagramValidation.profile
      // Logo desde la foto de perfil validada, en paralelo con la web y los buses. Nunca falla.
      const logoPromise = timed('logo', async () => fetchPlaceLogo(profile, placeId, {
        storage: this.logoStorage,
        classify: (image, model) => this.limited('llm', rateLimits, () => this.classifyLogo(image, model)),
        model: this.logoModel,
        fetcher: this.logoFetcher,
        known: profile ? await pictureClassifications.get(profile.url) ?? null : null,
      }))
      // Y al revés: sin web todavía, la que enlaza el Instagram validado si su dominio lleva la marca.
      if (!websiteUrl && profile) {
        websiteUrl = brandWebsite(profile.links, brand, this.reservationHosts, googleWebsite)
        website = await scrapeWebsite(websiteUrl)
      }
      if (website) costUsage.scrapingRequests = 1
      // Las páginas de otros países (otra marca con el mismo nombre) no son fuentes del local.
      const exaCandidates = exa ? sourceFromExa(exa).filter((source) => !isForeignSource(source.url, source.text)) : []
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
      const prominenceSignals: ProminenceSourceSignals = { instagramFollowers: profile?.followers ?? null }
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
      // El costo de clasificar fotos suma el del logo y el de las clasificadas al elegir el perfil.
      const logo = withPictureClassifications(await logoPromise, await Promise.all(pictureClassifications.values()))
      return {
        placeId,
        request,
        target: { ...targetFromDetails(placeId, details, request, transit), coordinates },
        sources,
        sourceText: deduplicated.stats,
        deterministicContact: resolveDeterministicContact(details, sources, this.reservationHosts),
        instagramCandidates: candidates,
        instagramValidation,
        instagramFallback,
        ...(instagramTieBreak ? { instagramTieBreak } : {}),
        instagramActivity: profile ? instagramActivity(profile) : null,
        sharedInstagram: [...shared].map(([handle, places]) => ({ handle, places })),
        prominenceSignals,
        logo,
        rateLimits,
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
  private async retryHours(target: Target, sources: Source[], timings: Record<string, number>, rateLimits: RateLimitLog) {
    const startedAt = performance.now()
    const query = `${target.name} ${target.address} horario`
    const results = [await this.limited('exa', rateLimits, () => this.exa!.searchText!(query)).catch(() => null)]
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
      const generated = await this.limited('llm', rateLimits, () => this.generateHours(target, newSources, this.hoursModel))
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
    const logo = collected.logo ?? NO_LOGO
    const rateLimits = collected.rateLimits instanceof RateLimitLog ? collected.rateLimits : new RateLimitLog(collected.placeId)
    try {
      if (sources.length === 0) {
        return {
          source: 'llm', status: 'no_sources', model: config.model,
          sourceAudit: instagramAudit(collected.instagramCandidates, collected.instagramValidation),
          performance: extractionPerformance(
            collected.elapsedMs, timings, collected.sourceText, null,
            extractionCost(this.costRates, collected.costUsage, config.model, null, null, logo.classification),
          ),
          target,
        }
      }
      // El modelo no necesita las líneas de buses para extraer.
      const promptTarget: Target = { ...target, transit: { status: 'unavailable', lines: [] } }
      // El tiempo del LLM no incluye la espera en la cola de concurrencia.
      const generated = await this.limited('llm', rateLimits, async () => {
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
        prominenceSignals: collected.prominenceSignals,
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
        const retry = await this.retryHours(promptTarget, sources, timings, rateLimits)
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
      // Instagram rechazado por el modelo: tampoco su foto como logo ni su actividad para el estado.
      const validatedHandle = collected.instagramValidation.profile ? instagramHandle(collected.instagramValidation.profile.url) : null
      const modelRejectedInstagram = Boolean(validatedHandle) && instagramRejectedByModel(data, validatedHandle)
      const placeLogo = modelRejectedInstagram ? NO_LOGO : logo
      place = { ...place, logo: placeLogo.logo }
      // Una cuenta agregadora tampoco queda como contacto aunque la cite una fuente de terceros.
      if (place.contact.instagram && collected.sharedInstagram?.some((item) => item.handle === place.contact.instagram!.toLowerCase())) {
        place = { ...place, contact: { ...place.contact, instagram: null } }
      }
      // Salida del modelo y fuentes a disco, sin nada de Google, para re-correr postProcess sin el LLM. Nunca corta.
      await this.snapshots?.save({
        googlePlaceId: target.googlePlaceId,
        savedAt: new Date().toISOString(),
        model: config.model,
        request: collected.request,
        transit: target.transit,
        sources: allSources,
        deterministicContact: collected.deterministicContact,
        prominenceSignals: collected.prominenceSignals ?? null,
        instagramActivity: collected.instagramActivity ?? null,
        llmOutput: data,
        instagramAudit: {
          candidates: collected.instagramValidation.candidates,
          validated: validatedHandle,
          modelRejected: modelRejectedInstagram,
          saved: place.contact.instagram,
          ...(collected.instagramFallback ? { fallback: collected.instagramFallback } : {}),
          ...(collected.instagramTieBreak ? { tieBreak: collected.instagramTieBreak } : {}),
        },
      }).catch((error: unknown) => console.warn(JSON.stringify({ event: 'extraction_snapshot_failed', placeId: target.googlePlaceId, error: String(error) })))
      const review = reviewExtraction(place, data, hoursRetry, placeLogo.review, rateLimits.summary(), collected.instagramFallback, collected.instagramTieBreak, collected.sharedInstagram)
      const activity = modelRejectedInstagram ? null : collected.instagramActivity
      place = { ...place, reviewReasons: reviewReasonsFor(place, review, { instagramOperating: instagramOperating(activity, new Date()) }) }
      return {
        source: 'llm', status: 'ok', model: config.model,
        // La salida del modelo con la que se armó el place (con el horario recuperado, si lo hubo): con las mismas
        // fuentes, postProcess la vuelve a procesar sin otra llamada al LLM.
        review: { ...review, llmOutput: data },
        sourceAudit: instagramAudit(collected.instagramCandidates, collected.instagramValidation, place.contact.instagram, place.placeFacts, allSources),
        performance: extractionPerformance(
          collected.elapsedMs + (performance.now() - startedAt), timings, collected.sourceText, usage,
          extractionCost(this.costRates, costUsage, config.model, usage, hoursRetryUsage ? { model: this.hoursModel.model, usage: hoursRetryUsage } : null, logo.classification),
        ),
        place,
        logoUrl: logoUrl(place.logo?.key),
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
