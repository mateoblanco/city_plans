import type { IntentId } from '@shared/intents.ts'
import type { SectionId } from '@shared/sections.ts'
import type { TagId } from '@shared/tags.ts'
import type { SearchUrl } from '@/components/pages/SearchPage/utils/search-href'
import type { DietKey } from '../search/interpretation'
import type { SlotId } from './slots'

/**
 * Búsqueda estructurada de una fila de la home: nunca texto, así no hay modelo ni embedding (sólo SQL). Los mismos
 * parámetros arman la búsqueda y su "Ver todos". Las cocinas son tags (`tags: ['japanese']`).
 */
export type HomeSearch = {
  intent?: IntentId
  sub?: string[]
  diet?: DietKey[]
  tags?: TagId[]
  /** Un grupo del catálogo de /shared/sections.ts: la misma regla que su "Ver todos" en la búsqueda. */
  section?: Exclude<SectionId, 'discover'>
}

/** Lo que decide si una fila de la franja sale en este pedido: la hora real de Montevideo y si salió "cerca tuyo". */
export type HomeRowContext = { day: number; time: string; near: boolean }

export type HomeSectionDef = { id: string; title: string; search: HomeSearch; when?: (context: HomeRowContext) => boolean }

const breakfast: HomeSectionDef = { id: 'breakfast', title: 'Para desayunar', search: { tags: ['breakfast'] } }
const specialtyCoffee: HomeSectionDef = { id: 'specialty_coffee', title: 'Café de especialidad', search: { intent: 'cafes', sub: ['specialty'] } }
// Brunch por tag y no por sub-filtro: es sub de Comer y de Cafés, y así entran los dos. A la mañana y al mediodía.
const brunch: HomeSectionDef = { id: 'brunch', title: 'Brunch', search: { tags: ['brunch'] } }
const lunch: HomeSectionDef = { id: 'lunch', title: 'Para almorzar', search: { intent: 'eat', sub: ['lunch'] } }
const menuOfTheDay: HomeSectionDef = { id: 'menu_of_the_day', title: 'Menú del día', search: { tags: ['menu_of_the_day'] } }
const quick: HomeSectionDef = { id: 'quick', title: 'Algo rápido', search: { intent: 'eat', tags: ['quick'] } }
const coffee: HomeSectionDef = { id: 'coffee', title: 'Para tomar un café', search: { intent: 'cafes' } }
const sharedSnack: HomeSectionDef = { id: 'shared_snack', title: 'Merienda para 2', search: { tags: ['shared_afternoon_tea'] } }
const dinner: HomeSectionDef = { id: 'dinner', title: 'Para cenar', search: { intent: 'eat', sub: ['dinner'] } }
const drinks: HomeSectionDef = { id: 'drinks', title: 'Para tomar algo', search: { intent: 'bars' } }
/** Sólo de lunes a viernes y hasta las 21:00. */
const afterOffice: HomeSectionDef = {
  id: 'after_office',
  title: 'After office',
  search: { tags: ['after_office'] },
  when: ({ day, time }) => day >= 1 && day <= 5 && time < '21:00',
}
/** Todo lo abierto (por calidad): sólo sin "Abierto ahora cerca tuyo", que ya es lo mismo cerca. */
const openNow: HomeSectionDef = { id: 'open_now', title: 'Abierto ahora', search: {}, when: ({ near }) => !near }

/** Las filas de cada franja (hora de Montevideo), en este orden, después de "Abierto ahora cerca tuyo". */
export const SLOT_SECTIONS: Record<SlotId, HomeSectionDef[]> = {
  morning: [breakfast, specialtyCoffee, brunch],
  midday: [lunch, menuOfTheDay, quick, brunch],
  afternoon: [coffee, sharedSnack],
  night: [dinner, drinks, afterOffice],
  late: [drinks, openNow],
}

const friends: HomeSectionDef = { id: 'friends', title: 'Juntada con amigos', search: { tags: ['groups'] } }
const couple: HomeSectionDef = { id: 'couple', title: 'Salida en pareja', search: { tags: ['date'] } }
const rest: HomeSectionDef[] = [
  { id: 'world', title: 'Comidas del mundo', search: { section: 'world' } },
  { id: 'classics', title: 'Clásicos uruguayos', search: { section: 'classics' } },
  { id: 'vegetarian', title: 'Vegetariano', search: { diet: ['vegetarian'] } },
  { id: 'gluten_free', title: 'Sin TACC', search: { diet: ['glutenFree'] } },
]

/**
 * Las filas de siempre, después de "Para vos" y de los descuentos: de noche (y de trasnoche) "Salida en pareja" va
 * antes que "Juntada con amigos"; a la mañana, al final de la home.
 */
export function fixedSections(slot: SlotId): HomeSectionDef[] {
  if (slot === 'night' || slot === 'late') return [couple, friends, ...rest]
  if (slot === 'morning') return [friends, ...rest, couple]
  return [friends, couple, ...rest]
}

/** Todas las filas posibles, sin repetir (las de todas las franjas y las de siempre). */
export const HOME_SECTIONS: HomeSectionDef[] = [...new Set([...Object.values(SLOT_SECTIONS).flat(), ...fixedSections('midday')])]

export const HOME_CONFIG = {
  /** Una fila con menos lugares (después de sacar los repetidos y las cadenas) no se muestra. */
  minPlaces: 4,
  maxPlaces: 8,
  /** El pool de cada fila: cuántos resultados de su búsqueda se guardan en la caché, para completar sin repetir y reordenar. */
  candidates: 30,
  /** Las filas cacheadas (clave: fecha y franja) se rearman en segundo plano cada tantos minutos como máximo (home/swr.ts). */
  refreshMinutes: 10,
  /**
   * Peso de la afinidad al reordenar el pool (home/affinity.ts): con 30 lugares, uno sube o baja como mucho
   * candidates × peso ≈ 6 puestos, así los primeros del pool siguen entre los 8 que se ven.
   */
  affinityWeight: 0.2,
  /** "Abierto ahora cerca tuyo": manda la distancia, en bandas de tantos metros; la afinidad sólo desempata dentro. */
  nearBandM: 250,
} as const

/**
 * La búsqueda de una fila como estado de /search (sin texto): con esto se busca la fila y se arma su "Ver todos", así
 * /search muestra los mismos lugares (y más, sin el tope de 8). Siempre "Abierto ahora" y todo Montevideo (`loc=all`: sin
 * eso, /search con la ubicación de la persona buscaría cerca suyo).
 */
export function homeSearchUrl(search: HomeSearch): SearchUrl {
  const f = [
    'open:now',
    ...(search.diet ?? []).map((key) => `diet:${key}`),
    ...(search.tags ?? []).map((id) => `tag:${id}`),
    ...(search.section ? [`section:${search.section}`] : []),
  ].join(',')
  return { q: '', intent: search.intent ?? null, sub: search.intent && search.sub?.length ? search.sub.join(',') : null, f, loc: 'all' }
}
