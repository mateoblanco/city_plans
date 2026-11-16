import { SEARCH_CONFIG } from '../search/config'
import type { SearchResult } from '../search/search'
import { HOME_CONFIG } from './config'

/** Lo que la card "Ver todos" necesita de un lugar que no entró en la fila: su logo. */
export type RowLogo = Pick<SearchResult, 'id' | 'name' | 'logoUrl' | 'logoBgColor'>

export type HomeRow = {
  id: string
  title: string
  places: SearchResult[]
  href: string | null
  /**
   * Sólo después de assembleHome y con `href`: los siguientes del pool a los que se ven (mismas reglas: sin cadenas ni
   * repetidos de filas anteriores ni de esta), hasta HOME_CONFIG.viewAllLogos. Vacío: la fila ya muestra todo.
   */
  more?: RowLogo[]
}

/** La card y las sucursales que tiene detrás: ninguna de ellas puede volver a salir en otra fila. */
const cardIds = (place: SearchResult) => [place.id, ...place.branches.map((branch) => branch.id)]

const isChain = (place: SearchResult) => place.branchCount >= SEARCH_CONFIG.personal.chainMinBranches

const rowLogo = (place: SearchResult): RowLogo => ({ id: place.id, name: place.name, logoUrl: place.logoUrl, logoBgColor: place.logoBgColor })

/**
 * Las filas de la home en orden (rows ya viene con "Abierto ahora cerca tuyo" y "Para vos" primero, si salieron): cada una sin las cadenas (como los
 * bloques personales) ni los lugares de las filas anteriores, hasta maxPlaces; con menos de minPlaces no se muestra y
 * sus lugares quedan libres para las siguientes. Cada fila conserva el orden de su búsqueda. Las filas con "Ver todos"
 * llevan en `more` los logos de los que siguen en el pool (los mismos datos, sin otra consulta); no cuentan como mostrados.
 */
export function assembleHome(rows: HomeRow[], limits: { min: number; max: number } = { min: HOME_CONFIG.minPlaces, max: HOME_CONFIG.maxPlaces }): HomeRow[] {
  const shown = new Set<string>()
  const result: HomeRow[] = []
  for (const row of rows) {
    const fits = (place: SearchResult) => !isChain(place) && !cardIds(place).some((id) => shown.has(id))
    const places = row.places.filter(fits).slice(0, limits.max)
    if (places.length < limits.min) continue
    for (const place of places) for (const id of cardIds(place)) shown.add(id)
    // Con los de esta fila ya en `shown`, lo que sigue cumpliendo son los siguientes del pool a los que se ven.
    const more = row.href ? row.places.filter(fits).slice(0, HOME_CONFIG.viewAllLogos).map(rowLogo) : []
    result.push({ ...row, places, more })
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
