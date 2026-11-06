/**
 * Formato común de descuentos: todos los proveedores (bancos, billeteras, financieras, clubes) devuelven esto, lo lea
 * como lo lea cada uno. Compartido entre el backoffice (que llena las tablas discount_*) y la app (que las lee).
 */

export const PROVIDER_KINDS = ['bank', 'wallet', 'financial', 'club'] as const
export type ProviderKind = (typeof PROVIDER_KINDS)[number]

/** Un proveedor configurado en código (DISCOUNT_PROVIDERS, abajo). */
export type DiscountProvider = {
  id: string
  name: string
  kind: ProviderKind
  /** Página de la que sale el listado. */
  sourceUrl: string
  /** Parámetros del listado (filtros) y tope de páginas de seguridad, si el lector pagina. */
  listing?: { params: Record<string, string>; maxPages: number }
  /** Varias páginas fuente (Itaú: Restaurantes, Platinum y Personal Bank). Sin esto, la única es sourceUrl. */
  pages?: DiscountProviderPage[]
}

/** Una página fuente de un proveedor. */
export type DiscountProviderPage = {
  url: string
  label: string
  /**
   * Las tarjetas que esta página le da a este proveedor: pisan el tipo y los niveles que dice el texto (el porcentaje,
   * los días, la modalidad y las bases siguen saliendo de la página). Personal Bank: la misma página da débito y crédito
   * del paquete a Itaú Personal Bank y crédito Visa Infinite y Mastercard Black a Itaú.
   */
  cards?: { cardType: CardType; cardTiers: string[] }[]
  /**
   * Los lugares de esta página heredan el cruce manual (vinculado, confirmado o ignorado) del mismo logo en este otro
   * proveedor, si el suyo es nuevo o automático.
   */
  manualMatchFrom?: string
}

/**
 * Proveedores configurados. Cada uno tiene su lector en backoffice/server/discounts/readers.ts; todos devuelven este
 * formato común. La app los usa para los nombres y para validar los filtros de descuento.
 */
export const DISCOUNT_PROVIDERS = [
  {
    id: 'bbva',
    name: 'BBVA',
    kind: 'bank',
    sourceUrl: 'https://www.bbva.com.uy/personas/productos/tarjetas/descuentos/gastronomia.html',
  },
  {
    id: 'santander',
    name: 'Santander',
    kind: 'bank',
    // Los filtros van en el GET (no hace falta viewsreference ni Playwright). page=0, 1, … de 8 cards cada una.
    sourceUrl: 'https://www.santander.com.uy/beneficios',
    listing: {
      // 49 = Montevideo; 22 = Ruta Gourmet (las heladerías, 289, quedan afuera por ahora).
      params: { 'departamento[0]': '49', categoria: '22' },
      maxPages: 30,
    },
  },
  {
    id: 'itau',
    name: 'Itaú',
    kind: 'bank',
    // Las dos páginas tienen el mismo armado (pestañas por ciudad y logos por sección); un lugar que está en las dos es
    // uno solo, con los beneficios de cada una.
    sourceUrl: 'https://www.itau.com.uy/inst/restaurantes.html',
    pages: [
      // Crédito: cualquier tarjeta de crédito Itaú.
      { url: 'https://www.itau.com.uy/inst/restaurantes.html', label: 'Restaurantes' },
      // Crédito, nivel Platinum.
      { url: 'https://www.itau.com.uy/inst/restaurantesplatinum.html', label: 'Platinum' },
      // Las bases dicen "tarjetas de crédito y débito Personal Bank, Visa Infinite y MasterCard Black": Infinite y Black
      // son tarjetas que tiene cualquier cliente Itaú (no sólo Personal Bank), así que esta parte es de Itaú.
      {
        url: 'https://www.itau.com.uy/inst/restaurantespersonalbank.html',
        label: 'Personal Bank',
        cards: [{ cardType: 'credit', cardTiers: ['Visa Infinite', 'Mastercard Black'] }],
        manualMatchFrom: 'itau-personal-bank',
      },
    ],
  },
  {
    // Segmento de clientes (un paquete: cuenta, débito y crédito Personal Bank), no un nivel de tarjeta: va aparte de
    // Itaú. Los niveles Infinite y Black de la misma página van a Itaú.
    id: 'itau-personal-bank',
    name: 'Itaú Personal Bank',
    kind: 'bank',
    sourceUrl: 'https://www.itau.com.uy/inst/restaurantespersonalbank.html',
    pages: [
      {
        url: 'https://www.itau.com.uy/inst/restaurantespersonalbank.html',
        label: 'Personal Bank',
        cards: [{ cardType: 'debit', cardTiers: [] }, { cardType: 'credit', cardTiers: [] }],
      },
    ],
  },
] as const satisfies readonly DiscountProvider[]

export type DiscountProviderId = (typeof DISCOUNT_PROVIDERS)[number]['id']

export const CARD_TYPES = ['debit', 'credit', 'other'] as const
export type CardType = (typeof CARD_TYPES)[number]

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type Weekday = (typeof WEEKDAYS)[number]

/**
 * 'all': la fuente no restringe días (o dice "todos los días"); null: no se pudo determinar; una lista: esos días.
 */
export type BenefitDays = Weekday[] | 'all' | null

/** instant: en el momento; refund: reintegro; mixed: una parte en el momento y el resto como reintegro. */
export const BENEFIT_MODES = ['instant', 'refund', 'mixed', 'unknown'] as const
export type BenefitMode = (typeof BENEFIT_MODES)[number]

export const CAP_CURRENCIES = ['UYU', 'USD'] as const
export type CapCurrency = (typeof CAP_CURRENCIES)[number]
/** statement: por cierre de estado de cuenta. */
export const CAP_PERIODS = ['statement', 'month', 'week', 'day', 'purchase'] as const
export type CapPeriod = (typeof CAP_PERIODS)[number]

/** Tope: el texto original siempre; monto, moneda y período si se pudieron leer (si no, null). */
export type BenefitCap = {
  text: string
  amount: number | null
  currency: CapCurrency | null
  period: CapPeriod | null
}

export type DiscountBenefit = {
  /**
   * Estable entre corridas: proveedor, lugar, tipo de tarjeta, niveles y programa, sin el porcentaje (si cambia el
   * porcentaje, se actualiza el mismo beneficio). Dos iguales en todo eso: el segundo con "#2".
   */
  id: string
  percent: number
  cardType: CardType
  /** Niveles tal como los da la fuente ("Internacional", "Oro", "Platinum"…); vacío = todos o sin dato. */
  cardTiers: string[]
  /** Sólo con una tarjeta co-branded ("Nacional", "Peñarol"); null = cualquier tarjeta del tipo. */
  cardProgram: string | null
  days: BenefitDays
  /** Texto original de los días, si la fuente lo da. */
  daysText: string | null
  mode: BenefitMode
  /** Parte que se descuenta en el momento (instant o mixed). */
  instantPercent: number | null
  /** Parte que vuelve como reintegro (refund o mixed). */
  refundPercent: number | null
  /** Tope ("4000 pesos uruguayos por cierre de estado de cuenta" → 4000 · UYU · statement); null sin tope informado. */
  cap: BenefitCap | null
  /** ISO (YYYY-MM-DD): del beneficio o, si la fuente no lo separa, de toda la campaña. */
  validFrom: string | null
  validTo: string | null
  /** Texto original de alcance y exclusiones ("No aplica a…", "no acumulable"…). */
  conditions: string | null
  /** De dónde salió: la línea del beneficio y el párrafo legal. */
  sourceText: string
  /** La página de la que salió (un lugar puede tener beneficios de varias páginas del proveedor). */
  sourceUrl: string | null
  parsedBy: 'html' | 'llm'
}

export type ProviderPlaceLocation = {
  address: string
  /** Barrio o localidad tal como lo escribe la fuente. */
  area: string | null
  /** Departamento, si la fuente agrupa los locales por departamento ("Locales en Canelones:"). */
  department: string | null
  mapsUrl: string | null
  /** Coordenadas que da la fuente (Santander, en el link a Maps). Falta o null si no las da (BBVA: links cortos). */
  coordinates?: { lat: number; lng: number } | null
}

export const MATCH_STATUSES = ['found', 'doubtful', 'missing', 'not_matched'] as const
export type MatchStatus = (typeof MATCH_STATUSES)[number]

export type MatchCandidate = {
  placeId: string
  name: string
  neighborhoodId: string
  brandKey: string | null
  score: number
  reasons: string[]
}

export const MATCH_ORIGINS = ['auto', 'manual'] as const
export type MatchOrigin = (typeof MATCH_ORIGINS)[number]

/** Un vínculo con un lugar nuestro. Un lugar del proveedor puede tener varios (sucursales). */
export type DiscountLink = {
  placeId: string
  name: string
  neighborhoodId: string
  origin: MatchOrigin
  /** Vinculado por ser de la marca (la fuente no dice qué sucursal), no por una dirección. */
  wholeBrand: boolean
  score: number | null
  reasons: string[]
  /** Qué dirección de la fuente (locations[i]) cruzó; null si no salió de una dirección. */
  locationIndex: number | null
}

/**
 * Cruce con `places`. found: vinculado (a uno o varios); doubtful: candidatos (y quizás algunos vínculos, si cruzaron
 * sólo algunas direcciones); missing: no está en la base; not_matched: fuera de Montevideo, no se cruza.
 * origin manual: lo corrigió alguien y las corridas no lo tocan.
 */
export type DiscountMatch = {
  status: MatchStatus
  origin: MatchOrigin
  links: DiscountLink[]
  candidates: MatchCandidate[]
  /**
   * Encontrado en parte: locales de Montevideo de la fuente sin ningún lugar nuestro (ni cerca ni en su barrio): "faltan
   * sucursales en la base". Se calcula al leer; 0 si no aplica.
   */
  missingBranches: number
  /**
   * Lugares nuestros a ≤ 150 m de un local de la fuente que no quedaron vinculados (otro nombre). Sólo una nota: no son
   * candidatos ni cambian el estado. Se calcula al leer.
   */
  nearby: NearbyPlace[]
}

export type NearbyPlace = { placeId: string; name: string; neighborhoodId: string; meters: number; address: string }

/** Lo que lee cada proveedor, antes de cruzar y guardar. */
export type ProviderPlace = {
  /** `${providerId}:${slug de la fuente}`. */
  id: string
  providerId: string
  /** Nombre tal cual lo da la fuente. */
  sourceName: string
  /** Rubro de la fuente ("Restaurante", "Cafetería"). */
  category: string | null
  /** Ciudad, localidad o barrio tal cual lo da la fuente ("Pocitos, Montevideo", "Atlantida", "Montevideo y Maldonado"). */
  city: string | null
  /** Departamentos que da la fuente (puede ser más de uno). */
  departments: string[]
  /** Está (también) en Montevideo: por departamento, por un barrio reconocido o por la dirección. Sólo estos se cruzan. */
  montevideo: boolean
  locations: ProviderPlaceLocation[]
  website: string | null
  /** Handle sin @, en minúscula. */
  instagram: string | null
  /** Página del lugar en el sitio del proveedor. */
  sourceUrl: string
  /** URL del logo en el sitio del proveedor (no se descarga). */
  logoUrl: string | null
  description: string | null
  /** Etiquetas crudas de la fuente (tarjetas co-branded, departamento). */
  sourceTags: string[]
  campaign: { validFrom: string | null; validTo: string | null; text: string | null }
  benefits: DiscountBenefit[]
}

/** Un beneficio guardado (discount_benefits). */
export type StoredBenefit = DiscountBenefit & {
  firstSeenAt: string
  lastSeenAt: string
  /** Apareció en la última corrida que leyó su detalle. */
  active: boolean
  /**
   * La fecha de fin ya pasó. Si sigue `active` (publicado en la última corrida), es "vigencia desactualizada en la
   * fuente" y cuenta como vigente; si no, está vencido.
   */
  expired: boolean
}

/** Un lugar del proveedor guardado (discount_places), con sus beneficios y su cruce. */
export type DiscountPlace = Omit<ProviderPlace, 'benefits'> & {
  benefits: StoredBenefit[]
  match: DiscountMatch
  firstSeenAt: string
  lastSeenAt: string
  /** Apareció en la última corrida del proveedor que terminó bien. */
  active: boolean
  ignored: boolean
  matchedAt: string | null
}

export type DiscountRunProvider = {
  providerId: string
  name: string
  kind: ProviderKind
  status: 'ok' | 'partial' | 'error'
  places: number
  error?: string
  requests: number
  llm: { calls: number; costUsd: number }
  /** Notas de la corrida que no son problemas ("44 beneficios por reglas", lo omitido a propósito). */
  notes?: string[]
}

export type DiscountRunError = { providerId: string; url: string; message: string }

export type DiscountRun = {
  id: string
  startedAt: string
  finishedAt: string
  /** Reprocesada desde el HTML crudo de otra corrida (sin bajar nada). */
  reparsedFrom: string | null
  providers: DiscountRunProvider[]
  /** Errores parciales: un detalle que no se pudo leer no corta la corrida. */
  errors: DiscountRunError[]
  warnings: string[]
}

export type DiscountRunProgress =
  | { status: 'idle' }
  | { status: 'running'; runId: string; startedAt: string; providerId: string; phase: 'listing' | 'details' | 'matching'; done: number; total: number | null }
  | { status: 'done'; runId: string; finishedAt: string }
  | { status: 'error'; runId: string; finishedAt: string; message: string }

/** GET /api/discounts: todo lo guardado (los filtros van en el cliente) y la última corrida. */
export type DiscountsResponse = { run: DiscountRun | null; places: DiscountPlace[] }

/** PUT /api/discounts/places/:id/links. */
export type DiscountLinksRequest = { links: { placeId: string; wholeBrand?: boolean }[] }
