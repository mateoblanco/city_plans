import { z } from 'zod'
import { CATEGORIES, TAG_IDS, ids } from './tags.ts'

const DietLevel = z.enum(['unknown', 'no', 'has_options', 'fully'])
const TransitStatus = z.enum(['success', 'partial', 'unavailable'])

// Contrato del borrador que más adelante podrá mapearse a tablas de la base.
// Los IDs y campos de curaduría no pertenecen a esta extracción automática.
export const PlaceDraft = z.object({
  name: z.string(),
  address: z.string(),
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
  embeddingText: z.string(),
  keywordText: z.string(),
})

export type PersistablePlaceDraft = z.infer<typeof PlaceDraft>
