import { z } from 'zod'
import { CATEGORIES, CUISINES, DRINKS, FEATURES, FOODS, GOOD_FOR, MOMENTS, ids } from './tags.ts'

const DietLevel = z.enum(['unknown', 'no', 'has_options', 'fully'])
const TriState = z.enum(['unknown', 'yes', 'no'])
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
    slots: z.array(z.object({ day: z.number().int().min(0).max(6), opens: z.string(), closes: z.string().nullable() })),
    status: z.enum(['exact', 'partial', 'vague', 'none']),
    source: z.enum(['official', 'third_party']).nullable(),
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
  embeddingText: z.string(),
  keywordText: z.string(),
})

export type PersistablePlaceDraft = z.infer<typeof PlaceDraft>
