import { z } from 'zod'
import { CATEGORIES, STYLE_IDS, TAG_IDS, ids } from './tags.ts'
import { ICON_CATEGORY_KEYS } from './icon-categories.ts'
import { REVIEW_REASON_IDS } from './review-reasons.ts'
import { LOGO_KINDS } from './place-schema.ts'
import { ManualHours } from './hours-edit.ts'
import { MONTEVIDEO_NEIGHBORHOODS } from './neighborhoods.ts'

// Campos que el backoffice edita a mano, guardados en places.manual_overrides (jsonb) con el nombre de la columna SQL.
// Una clave presente bloquea el campo: ningún camino automático lo cambia (server/places/manual-overrides.ts).
// tags es la excepción: guarda la diferencia con lo automático, así una re-extracción suma tags nuevos pero no
// vuelve a poner los que se sacaron a mano. Las cocinas son tags (grupo cuisines). dishes (platos, texto libre) igual.

export const PRICE_LEVELS = ['unknown', 'low', 'moderate', 'high'] as const
/** Las mismas en todo el backoffice (y en la app de búsqueda: Accesible, Normal, Caro). */
export const PRICE_LABELS: Record<(typeof PRICE_LEVELS)[number], string> = { unknown: 'Sin precio', low: '$ Accesible', moderate: '$$ Normal', high: '$$$ Caro' }
export const DIET_LEVELS = ['unknown', 'no', 'has_options', 'fully'] as const
export const PLACE_STATUSES = ['draft', 'published', 'review', 'hidden'] as const
export const RESERVATION_LEVELS = ['accepts', 'recommended', 'no_reservations', 'unknown'] as const
export const RESERVATION_LABELS: Record<(typeof RESERVATION_LEVELS)[number], string> = {
  accepts: 'Acepta reservas', recommended: 'Reservas recomendadas', no_reservations: 'No toma reservas', unknown: 'Sin dato',
}
export const MAX_SIGNATURE = 3
export const MAX_DISHES = 30
export const MAX_HIGHLIGHTS = 15
export const MAX_CATEGORIES = 6

/** Plato como lo guarda el pipeline: en minúscula y sin espacios de más. */
export const normalizeDish = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()
/** Para comparar textos libres (destacados) sin mayúsculas ni acentos. */
export const textKey = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLowerCase()

const HexColor = z.string().regex(/^#[0-9a-f]{6}$/)
export const LOGO_KEY = /^logos\/[A-Za-z0-9_-]+-[0-9a-f]{8}\.webp$/
export const INSTAGRAM_HANDLE = /^[a-z0-9._]{1,30}$/
// Como slugify: minúsculas, números y guiones.
export const BRAND_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const Dish = z.string().transform(normalizeDish).pipe(z.string().min(1).max(80))
const Highlight = z.string().trim().min(1).max(120)
const uniqueList = <T>(values: readonly T[]) => new Set(values).size === values.length

export const ManualLogo = z.object({
  key: z.string().regex(LOGO_KEY),
  kind: z.enum(LOGO_KINDS).nullable(),
  bgColor: HexColor.nullable(),
  color: HexColor.nullable(),
  source: z.literal('manual'),
  fetchedAt: z.string().datetime(),
})

export const ManualOverrides = z.object({
  // Decisiones de Publicar y de la revisión del Instagram (existían como bloqueo en el text[] anterior).
  status: z.enum(PLACE_STATUSES).optional(),
  // Handle sin @; null = "No tiene Instagram".
  instagram: z.string().regex(INSTAGRAM_HANDLE).nullable().optional(),
  review_reasons: z.array(z.enum(REVIEW_REASON_IDS)).optional(),

  name: z.string().trim().min(1).max(200).optional(),
  style: z.enum(STYLE_IDS).nullable().optional(),
  icon_category: z.enum(ICON_CATEGORY_KEYS).nullable().optional(),
  price: z.enum(PRICE_LEVELS).optional(),
  diet_vegan: z.enum(DIET_LEVELS).optional(),
  diet_vegetarian: z.enum(DIET_LEVELS).optional(),
  diet_gluten_free: z.enum(DIET_LEVELS).optional(),
  website: z.url({ protocol: /^https?$/ }).max(500).nullable().optional(),
  brand_key: z.string().regex(BRAND_KEY).max(100).nullable().optional(),
  // Sucursal de cadena puesta a mano: manda sobre la regla automática (y el ×0,85 de prominencia la sigue).
  chain_branch: z.boolean().optional(),
  logo: ManualLogo.optional(),
  // Turnos cargados a mano; la columna hours guarda el horario entero (display y raw salen de los turnos).
  hours: ManualHours.optional(),

  // Categorías, barrio, "dentro de", reservas, signature y destacados guardan el valor y bloquean el campo. Las
  // categorías también las usa el pipeline al re-extraer (lo que deriva de ellas: tags implícitos, precio, motivos).
  categories: z.array(z.enum(ids(CATEGORIES))).min(1).max(MAX_CATEGORIES).refine(uniqueList).optional(),
  neighborhood_id: z.enum(MONTEVIDEO_NEIGHBORHOODS).optional(),
  located_in: z.string().trim().min(1).max(120).nullable().optional(),
  reservations: z.enum(RESERVATION_LEVELS).optional(),
  // Hasta 3 tags del lugar; si se saca uno de los tags, sale también de acá.
  signature: z.array(z.enum(TAG_IDS)).max(MAX_SIGNATURE).optional(),
  // es editado a mano; en se conserva del destacado que quedó igual y queda vacío en los nuevos.
  highlights: z.array(z.object({ es: Highlight, en: z.string().max(200) })).max(MAX_HIGHLIGHTS).optional(),

  tags: z.object({ add: z.array(z.enum(TAG_IDS)), remove: z.array(z.enum(TAG_IDS)) }).optional(),
  dishes: z.object({ add: z.array(Dish), remove: z.array(Dish) }).optional(),
})

export type ManualOverrides = z.infer<typeof ManualOverrides>
export type ManualLogo = z.infer<typeof ManualLogo>
export type OverrideField = keyof ManualOverrides

/** Campos que cuentan como "editado a mano": Publicar y los motivos de revisión son decisiones de status, no edición. */
export const EDIT_FIELDS = [
  'name', 'tags', 'style', 'icon_category', 'price', 'diet_vegan', 'diet_vegetarian', 'diet_gluten_free',
  'instagram', 'website', 'brand_key', 'chain_branch', 'logo', 'hours',
  'dishes', 'signature', 'highlights', 'categories', 'neighborhood_id', 'located_in', 'reservations',
] as const satisfies readonly OverrideField[]
export type EditField = (typeof EDIT_FIELDS)[number]

/** Lee manual_overrides de la base; una clave inválida se descarta (no bloquea nada) en vez de romper la lectura. */
export function parseManualOverrides(value: unknown): ManualOverrides {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const parsed: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(ManualOverrides.shape)) {
    if (!Object.hasOwn(value, key)) continue
    const result = field.safeParse((value as Record<string, unknown>)[key])
    if (result.success && result.data !== undefined) parsed[key] = result.data
  }
  return parsed as ManualOverrides
}

/** Campos editados a mano, para el indicador del modal y el filtro de la tabla. */
export function editedFields(overrides: ManualOverrides): EditField[] {
  return EDIT_FIELDS.filter((field) => {
    if (!Object.hasOwn(overrides, field)) return false
    if (field !== 'tags' && field !== 'dishes') return true
    const diff = overrides[field]
    return Boolean(diff && (diff.add.length > 0 || diff.remove.length > 0))
  })
}

/**
 * Edición desde el modal: sólo vienen los campos que cambiaron, con el valor final que se quiere. tags es la lista
 * completa (con las cocinas) y dishes también; la diferencia con lo automático la arma el servidor. highlights es la
 * lista de textos en español (el en lo arma el servidor). signature tiene que estar en los tags finales (lo valida el
 * servidor).
 */
export const PlaceEdit = z.object({
  name: ManualOverrides.shape.name,
  tags: z.array(z.enum(TAG_IDS)).max(200).optional(),
  style: ManualOverrides.shape.style,
  iconCategory: ManualOverrides.shape.icon_category,
  price: ManualOverrides.shape.price,
  dietVegan: ManualOverrides.shape.diet_vegan,
  dietVegetarian: ManualOverrides.shape.diet_vegetarian,
  dietGlutenFree: ManualOverrides.shape.diet_gluten_free,
  instagram: ManualOverrides.shape.instagram,
  website: ManualOverrides.shape.website,
  brandKey: ManualOverrides.shape.brand_key,
  chainBranch: ManualOverrides.shape.chain_branch,
  logo: ManualLogo.optional(),
  hours: ManualHours.optional(),
  dishes: z.array(Dish).max(MAX_DISHES).optional(),
  signature: ManualOverrides.shape.signature,
  highlights: z.array(Highlight).max(MAX_HIGHLIGHTS).optional(),
  categories: ManualOverrides.shape.categories,
  neighborhoodId: ManualOverrides.shape.neighborhood_id,
  locatedIn: ManualOverrides.shape.located_in,
  reservations: ManualOverrides.shape.reservations,
  featured: z.boolean().optional(),
}).strict()

export type PlaceEdit = z.infer<typeof PlaceEdit>
