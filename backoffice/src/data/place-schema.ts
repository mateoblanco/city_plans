import { z } from 'zod'
import { CATEGORIES, STYLE_IDS, TAG_IDS, ids } from './tags.ts'
import { ICON_CATEGORY_KEYS } from './icon-categories.ts'
import { REVIEW_REASON_IDS } from './review-reasons.ts'

const DietLevel = z.enum(['unknown', 'no', 'has_options', 'fully'])
const TransitStatus = z.enum(['success', 'partial', 'unavailable'])
export const LOGO_KINDS = ['logo', 'local', 'food', 'person', 'other'] as const
export const LOGO_SOURCES = ['instagram', 'owner'] as const
const HexColor = z.string().regex(/^#[0-9a-f]{6}$/)

// Contrato del borrador que más adelante podrá mapearse a tablas de la base.
// Los IDs y campos de curaduría no pertenecen a esta extracción automática.
export const PlaceDraft = z.object({
  // Nombre y dirección salen de las fuentes, nunca de Google. Un nombre vacío no se puede guardar.
  name: z.string(),
  address: z.string().nullable(),
  coordinates: z.object({
    lat: z.number(),
    lng: z.number(),
    source: z.enum(['osm', 'google', 'manual']),
    fetchedAt: z.string().datetime(),
  }),
  neighborhoodId: z.string().nullable(),
  city: z.literal('Montevideo'),
  googlePlaceId: z.string(),
  transit: z.object({
    status: TransitStatus,
    lines: z.array(z.object({ line: z.string(), stopId: z.string(), meters: z.number().int().nonnegative() })),
  }),
  categories: z.array(z.enum(ids(CATEGORIES))),
  // Un solo array con ids de tags.ts; groupOf(id) devuelve su grupo.
  tags: z.array(z.enum(TAG_IDS)),
  dietary: z.object({ vegan: DietLevel, vegetarian: DietLevel, glutenFree: DietLevel }),
  price: z.enum(['unknown', 'low', 'moderate', 'high', 'very_high']),
  reservations: z.enum(['unknown', 'no_reservations', 'accepts', 'recommended']),
  hours: z.object({
    raw: z.string().nullable(),
    display: z.object({ es: z.string(), en: z.string() }).nullable(),
    slots: z.array(z.object({ day: z.number().int().min(0).max(6), opens: z.string(), closes: z.string().nullable() })),
    status: z.enum(['exact', 'partial', 'vague', 'none']),
    source: z.enum(['official', 'third_party']).nullable(),
    /** Por qué no hay horario: la UI muestra el de Google en vivo. null si hay horario. */
    missingReason: z.enum(['chain_branch_not_found', 'no_data']).nullable(),
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
  dishes: z.array(z.string()).max(15),
  // signature es un subconjunto de tags.
  signature: z.array(z.enum(TAG_IDS)).max(3),
  description: z.object({ es: z.string(), en: z.string() }),
  locatedIn: z.string().nullable(),
  placeFacts: z.array(z.object({
    id: z.string(),
    text: z.string(),
    kind: z.enum(['food', 'drink', 'feature', 'hours', 'dietary', 'price', 'reservations', 'contact', 'other']),
    sourceId: z.string(),
    sourceUrl: z.string(),
    trust: z.enum(['official', 'third_party']),
    supports: z.array(z.string()),
  })),
  // Señales de prominencia; el default acepta resultados de antes de que existieran.
  signals: z.object({
    igFollowers: z.number().int().nonnegative().nullable(),
    chainBranch: z.boolean().default(false),
  }).default({ igFollowers: null, chainBranch: false }),
  // Logo en R2 (sólo la clave); el default acepta resultados de antes de que existiera.
  logo: z.object({
    key: z.string().regex(/^logos\/[A-Za-z0-9_-]+-[0-9a-f]{8}\.webp$/),
    kind: z.enum(LOGO_KINDS).nullable(),
    bgColor: HexColor.nullable(),
    color: HexColor.nullable(),
    source: z.enum(LOGO_SOURCES),
    fetchedAt: z.string().datetime(),
  }).nullable().default(null),
  // Categoría de ícono; null = todavía sin categoría (también en resultados de antes de que existiera).
  iconCategory: z.enum(ICON_CATEGORY_KEYS).nullable().default(null),
  // Estilo de la marca; null sin señales (también en resultados de antes de que existiera).
  style: z.enum(STYLE_IDS).nullable().default(null),
  // Motivos para no publicar (review-reasons.ts); vacío = se publica. Falta en resultados de antes.
  reviewReasons: z.array(z.enum(REVIEW_REASON_IDS)).default([]),
  // Respaldo de momentos, cozy y style: sólo para auditar, no se guarda.
  tagEvidence: z.array(z.object({
    tag: z.string(),
    mode: z.enum(['explicit', 'inferred']),
    basis: z.enum(['signals', 'price', 'icon']).optional(),
    signals: z.array(z.string()),
    factIds: z.array(z.string()),
  })).default([]),
  embeddingText: z.string(),
  keywordText: z.string(),
})

export type PersistablePlaceDraft = z.infer<typeof PlaceDraft>
