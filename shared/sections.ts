import type { IconCategory } from './icon-categories.ts'
import { CUISINES, TAG_FILTERS, type CategoryId, type Lang, type StyleId, type TagId } from './tags.ts'

/**
 * Grupos con título en los que se ordenan los resultados de una búsqueda amplia ("comer con amigos"). Un lugar
 * entra si tiene alguna de las categorías, alguno de los tags, el style o uno de los íconos. discover no tiene regla de tags: lo
 * decide la búsqueda (prominencia baja y buena coincidencia). Los títulos son siempre estos, nunca libres.
 */
export type SectionMatch = { categories?: CategoryId[]; tags?: TagId[]; style?: StyleId; icons?: IconCategory[]; discover?: true }

export type SectionDef = {
  title: Record<Lang, string>
  /** Para el prompt del modelo: qué lugares entran. */
  rule: string
  match: SectionMatch
  /** Señales que no hacen entrar a nadie pero ordenan dentro de la sección (boost sectionFit). */
  bonus?: { tags?: TagId[] }
}

const WORLD_CUISINES = Object.keys(CUISINES).filter((id) => id !== 'uruguayan') as TagId[]

export const SECTIONS = {
  drinks: { title: { es: 'Para tomar algo', en: 'For a drink' }, rule: 'bares, cervecerías y vinotecas', match: { categories: ['bar', 'brewery', 'wine_bar'] } },
  eat: { title: { es: 'Para comer', en: 'To eat' }, rule: 'restaurantes, pizzerías y parrillas', match: { categories: ['restaurant', 'pizzeria', 'grill'] } },
  casual: { title: { es: 'Descontracturado', en: 'Laid-back' }, rule: 'lugares de estilo casual', match: { style: 'casual' } },
  special: { title: { es: 'Algo especial', en: 'Something special' }, rule: 'lugares de estilo cuidado', match: { style: 'cuidado' } },
  world: { title: { es: 'Comida del mundo', en: 'World food' }, rule: 'alguna cocina que no sea la uruguaya', match: { tags: WORLD_CUISINES } },
  classics: {
    title: { es: 'Clásicos uruguayos', en: 'Uruguayan classics' },
    rule: 'asado, parrilla, bodegón y chivito',
    // Los tags no hacen entrar a nadie: muchos bares y restaurantes que no son clásicos tienen carne o chivito.
    match: { categories: ['grill', 'bodegon', 'chiviteria'], icons: ['grill', 'meat'] },
    bonus: { tags: ['grilled_meat', 'chivito', 'milanesa', 'uruguayan', 'neighborhood_spot'] },
  },
  share: { title: { es: 'Para compartir', en: 'To share' }, rule: 'picadas, tablas y tapas', match: { tags: ['picada', 'tapas'] }, bonus: { tags: ['groups'] } },
  live_music: { title: { es: 'Con música en vivo', en: 'Live music' }, rule: 'música en vivo', match: { tags: ['live_music'] } },
  outdoor: { title: { es: 'Al aire libre', en: 'Outdoor' }, rule: 'terraza, patio, vereda o mesas afuera', match: { tags: [...TAG_FILTERS.outdoor.tags] } },
  discover: { title: { es: 'Descubrí', en: 'Discover' }, rule: 'lugares menos conocidos que coinciden bien con la búsqueda', match: { discover: true } },
} satisfies Record<string, SectionDef>

export type SectionId = keyof typeof SECTIONS
export const SECTION_IDS = Object.keys(SECTIONS) as SectionId[]
export const isSectionId = (value: string): value is SectionId => Object.hasOwn(SECTIONS, value)
export const sectionDef = (id: SectionId): SectionDef => SECTIONS[id]
