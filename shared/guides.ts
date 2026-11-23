/**
 * Guías editoriales: reglas compartidas entre el backoffice (que las escribe en `guides`, `guide_places` y
 * `guide_intros`) y la app (que las lee). Nada de contenido acá: las guías viven sólo en la base.
 */
import { NEIGHBORHOOD_NAMES, neighborhoodDisplayName } from './neighborhood-names.ts'

/** Los grupos, en el orden de las páginas de barrio y ciudad: Comer, Tomar algo, Cafés, Postres (ids de INTENTS). */
export const GUIDE_GROUPS = ['eat', 'bars', 'cafes', 'desserts'] as const
export type GuideGroup = (typeof GUIDE_GROUPS)[number]

export const GUIDE_STATUSES = ['draft', 'published'] as const
export type GuideStatus = (typeof GUIDE_STATUSES)[number]

/** Por ahora una sola ciudad. */
export const GUIDE_CITIES = ['montevideo'] as const
export type GuideCity = (typeof GUIDE_CITIES)[number]

/**
 * La página de un barrio (/guides/<ciudad>/<barrio>) existe recién con este mínimo de guías publicadas de ese barrio
 * (publicadas y con algún lugar publicado: las que tienen página). Antes, 404 y fuera del sitemap y de "Barrios".
 */
export const MIN_NEIGHBORHOOD_GUIDES = 3

/** Mínimo de lugares publicados para publicar una guía. */
export const MIN_GUIDE_PLACES = 4

/** Una guía publicada sin cambios de contenido en más meses que esto lleva aviso en el backoffice. */
export const STALE_AFTER_MONTHS = 6

/** Largo de la descripción para Google que se arma con la introducción. */
export const SEO_DESCRIPTION_MAX = 155

/** Minúsculas, números y guiones sueltos entre palabras ("cafes-donde-nadie-te-apura"). */
export const GUIDE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const GUIDE_SLUG_MIN = 3
export const GUIDE_SLUG_MAX = 80

/** El tramo de la URL de un barrio: su nombre sin tildes ni mayúsculas, con guiones ("Ciudad Vieja" → ciudad-vieja). */
export function neighborhoodSlug(id: string): string {
  return (neighborhoodDisplayName(id) ?? id)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

let neighborhoodSlugs: ReadonlySet<string> | null = null

/** Los tramos de URL de todos los barrios (tengan guías o no). */
export function allNeighborhoodSlugs(): ReadonlySet<string> {
  neighborhoodSlugs ??= new Set(Object.keys(NEIGHBORHOOD_NAMES).map(neighborhoodSlug))
  return neighborhoodSlugs
}

/** El id del barrio ('CORDON') por el tramo de la URL ('cordon'); null si no es un barrio. */
export function neighborhoodIdFromSlug(slug: string): string | null {
  return Object.keys(NEIGHBORHOOD_NAMES).find((id) => neighborhoodSlug(id) === slug) ?? null
}

export const isGuideSlug = (slug: string) => slug.length >= GUIDE_SLUG_MIN && slug.length <= GUIDE_SLUG_MAX && GUIDE_SLUG_RE.test(slug)

/**
 * Un slug de guía no puede ser el de un barrio (cualquiera, tenga guías o no): /guides/montevideo/<segmento> resuelve
 * primero el barrio y la guía no se vería nunca. Vale para todas las guías, también las de barrio.
 */
export const slugClashesWithNeighborhood = (slug: string) => allNeighborhoodSlugs().has(slug)

export type GuideDraftInput = {
  slug: string
  group: string
  title: string
  seoTitle: string
  seoDescription: string
  intro: string
  places: readonly { placeId: string; text: string; published?: boolean }[]
}

export type PublishIssue =
  | { code: 'required'; field: 'slug' | 'group' | 'title' | 'seoTitle' | 'seoDescription' | 'intro'; message: string }
  | { code: 'place_text'; placeId: string; message: string }
  | { code: 'min_places'; message: string }
  | { code: 'slug_invalid'; message: string }
  | { code: 'slug_neighborhood'; message: string }

const REQUIRED: [Exclude<keyof GuideDraftInput, 'places'>, string][] = [
  ['slug', 'Falta el slug.'],
  ['group', 'Falta el grupo.'],
  ['title', 'Falta el título.'],
  ['seoTitle', 'Falta el título para Google.'],
  ['seoDescription', 'Falta la descripción para Google.'],
  ['intro', 'Falta la introducción.'],
]

/** Lo que el slug tiene de malo (formato o choque con un barrio); vacío si sirve. No mira duplicados (eso es de la base). */
export function slugIssues(slug: string): PublishIssue[] {
  const value = slug.trim()
  if (!value) return []
  if (!isGuideSlug(value))
    return [{ code: 'slug_invalid', message: `El slug sólo puede tener minúsculas, números y guiones (de ${GUIDE_SLUG_MIN} a ${GUIDE_SLUG_MAX} caracteres).` }]
  if (slugClashesWithNeighborhood(value)) return [{ code: 'slug_neighborhood', message: `"${value}" es el nombre de un barrio: elegí otro slug.` }]
  return []
}

/**
 * Lo que falta para publicar: campos obligatorios, el texto de cada lugar, el mínimo de lugares publicados (un lugar con
 * `published: false` no cuenta) y un slug válido. Vacío = se puede publicar.
 */
export function publishIssues(guide: GuideDraftInput): PublishIssue[] {
  const issues: PublishIssue[] = []
  for (const [field, message] of REQUIRED) if (!guide[field].trim()) issues.push({ code: 'required', field, message } as PublishIssue)
  issues.push(...slugIssues(guide.slug))
  const published = guide.places.filter((place) => place.published !== false)
  if (published.length < MIN_GUIDE_PLACES)
    issues.push({ code: 'min_places', message: `Hacen falta al menos ${MIN_GUIDE_PLACES} lugares publicados (hay ${published.length}).` })
  for (const place of guide.places) if (!place.text.trim()) issues.push({ code: 'place_text', placeId: place.placeId, message: 'Falta el texto de un lugar.' })
  return issues
}

/** La introducción en párrafos: separados por una línea en blanco, sin espacios de más ni párrafos vacíos. */
export const introParagraphs = (intro: string | null | undefined): string[] =>
  (intro ?? '')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

/**
 * La descripción para Google sacada del comienzo de la introducción: entera si entra; si no, hasta la última oración
 * completa que entre (si queda razonable) o hasta la última palabra, con "…". null sin introducción.
 */
export function seoDescriptionFromIntro(intro: string | null | undefined, max = SEO_DESCRIPTION_MAX): string | null {
  const text = introParagraphs(intro).join(' ')
  if (!text) return null
  if (text.length <= max) return text
  const head = text.slice(0, max)
  const sentenceEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '))
  if (sentenceEnd >= max * 0.5) return head.slice(0, sentenceEnd + 1)
  const cut = head.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, '')}…`
}

/** Prefijos en inglés; barrio y slug, en español. */
export const guideCityPath = (city: string) => `/guides/${city}`

export const guideNeighborhoodPath = (city: string, neighborhoodId: string) => `${guideCityPath(city)}/${neighborhoodSlug(neighborhoodId)}`

/**
 * Todas las guías, de barrio o de toda la ciudad, en /guides/<ciudad>/<slug>. El barrio es un dato de la guía (etiqueta y
 * filtro de candidatos), no parte de la URL. Por eso el slug no puede ser el de un barrio: /guides/<ciudad>/<barrio> es la
 * página del barrio.
 */
export const guideUrlPath = (guide: { city: string; slug: string }) => `${guideCityPath(guide.city)}/${guide.slug}`

/**
 * El slug a partir del título, sin IA: minúsculas, sin tildes, ñ → n, todo lo que no es letra o número pasa a un guion
 * (sin guiones repetidos ni en las puntas), hasta GUIDE_SLUG_MAX sin cortar al final en un guion.
 */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.slice(0, GUIDE_SLUG_MAX).replace(/-+$/g, '')
}
