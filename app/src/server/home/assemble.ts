import { SEARCH_CONFIG } from '../search/config'
import type { SearchResult } from '../search/search'
import { HOME_CONFIG } from './config'

export type HomeRow = { id: string; title: string; places: SearchResult[]; href: string | null }

/** La card y las sucursales que tiene detrás: ninguna de ellas puede volver a salir en otra fila. */
const cardIds = (place: SearchResult) => [place.id, ...place.branches.map((branch) => branch.id)]

const isChain = (place: SearchResult) => place.branchCount >= SEARCH_CONFIG.personal.chainMinBranches

/**
 * Las filas de la home en orden (rows ya viene con "Para vos" primero, si salió): cada una sin las cadenas (como los
 * bloques personales) ni los lugares de las filas anteriores, hasta maxPlaces; con menos de minPlaces no se muestra y
 * sus lugares quedan libres para las siguientes. Cada fila conserva el orden de su búsqueda.
 */
export function assembleHome(rows: HomeRow[], limits: { min: number; max: number } = { min: HOME_CONFIG.minPlaces, max: HOME_CONFIG.maxPlaces }): HomeRow[] {
  const shown = new Set<string>()
  const result: HomeRow[] = []
  for (const row of rows) {
    const places = row.places.filter((place) => !isChain(place) && !cardIds(place).some((id) => shown.has(id))).slice(0, limits.max)
    if (places.length < limits.min) continue
    for (const place of places) for (const id of cardIds(place)) shown.add(id)
    result.push({ ...row, places })
  }
  return result
}

/**
 * La home completa: "Guardados" (si hay) primero y sin tocar, después assembleHome con el resto. Los guardados no
 * entran en la regla de no repetir: sus lugares pueden salir también en "Para vos" y en las filas siguientes.
 */
export function assembleHomeWithSaved(saved: HomeRow | null, rows: HomeRow[]): HomeRow[] {
  return [...(saved ? [saved] : []), ...assembleHome(rows)]
}
