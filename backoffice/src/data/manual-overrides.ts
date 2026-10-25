import { z } from 'zod'
import { STYLE_IDS, TAG_IDS } from './tags.ts'
import { ICON_CATEGORY_KEYS } from './icon-categories.ts'
import { REVIEW_REASON_IDS } from './review-reasons.ts'
import { LOGO_KINDS } from './place-schema.ts'

// Campos que el backoffice edita a mano, guardados en places.manual_overrides (jsonb) con el nombre de la columna SQL.
// Una clave presente bloquea el campo: ningún camino automático lo cambia (server/places/manual-overrides.ts).
// tags es la excepción: guarda la diferencia con lo automático, así una re-extracción suma tags nuevos pero no
// vuelve a poner los que se sacaron a mano. Las cocinas son tags (grupo cuisines).

export const PRICE_LEVELS = ['unknown', 'low', 'moderate', 'high', 'very_high'] as const
export const DIET_LEVELS = ['unknown', 'no', 'has_options', 'fully'] as const
export const PLACE_STATUSES = ['draft', 'published', 'review', 'hidden'] as const

const HexColor = z.string().regex(/^#[0-9a-f]{6}$/)
export const LOGO_KEY = /^logos\/[A-Za-z0-9_-]+-[0-9a-f]{8}\.webp$/
export const INSTAGRAM_HANDLE = /^[a-z0-9._]{1,30}$/
// Como slugify: minúsculas, números y guiones.
export const BRAND_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

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
  logo: ManualLogo.optional(),

  tags: z.object({ add: z.array(z.enum(TAG_IDS)), remove: z.array(z.enum(TAG_IDS)) }).optional(),
})

export type ManualOverrides = z.infer<typeof ManualOverrides>
export type ManualLogo = z.infer<typeof ManualLogo>
export type OverrideField = keyof ManualOverrides

/** Campos que cuentan como "editado a mano": Publicar y los motivos de revisión son decisiones de status, no edición. */
export const EDIT_FIELDS = [
  'name', 'tags', 'style', 'icon_category', 'price', 'diet_vegan', 'diet_vegetarian', 'diet_gluten_free',
  'instagram', 'website', 'brand_key', 'logo',
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
    const tags = overrides.tags
    return field !== 'tags' || Boolean(tags && (tags.add.length > 0 || tags.remove.length > 0))
  })
}

/**
 * Edición desde el modal: sólo vienen los campos que cambiaron, con el valor final que se quiere. tags es la lista
 * completa (con las cocinas); la diferencia con lo automático la arma el servidor.
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
  logo: ManualLogo.optional(),
  featured: z.boolean().optional(),
}).strict()

export type PlaceEdit = z.infer<typeof PlaceEdit>
