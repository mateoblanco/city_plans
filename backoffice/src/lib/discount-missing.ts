import { neighborhoodDisplayName } from '../data/neighborhood-names.ts'
import type { MissingRow, StoredPlaceSearch } from '../types/discounts.ts'

// Vista "No están en la base" en la pantalla: agrupar por barrio y leer el estado de cada fila. Las filas las arma el
// servidor (server/discounts/missing.ts). Rutas relativas: también lo importa el servidor.

export type { MissingMember, MissingRow } from '../types/discounts.ts'

export type MissingGroup = { neighborhoodId: string | null; label: string; rows: MissingRow[] }

export const NO_NEIGHBORHOOD_LABEL = 'Sin barrio'

export const memberKey = (discountPlaceId: string, locationIndex: number | null) => `${discountPlaceId}#${locationIndex ?? 'x'}`

const neighborhoodLabel = (id: string | null) => (id ? neighborhoodDisplayName(id) ?? id : NO_NEIGHBORHOOD_LABEL)
const byLabel = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' })

/** Por barrio (alfabético, "Sin barrio" al final) y, dentro, por nombre. */
export function groupByNeighborhood(rows: MissingRow[]): MissingGroup[] {
  const groups = new Map<string | null, MissingRow[]>()
  for (const row of rows) groups.set(row.neighborhoodId, [...(groups.get(row.neighborhoodId) ?? []), row])
  return [...groups]
    .map(([neighborhoodId, items]) => ({ neighborhoodId, label: neighborhoodLabel(neighborhoodId), rows: items.sort((a, b) => byLabel(a.name, b.name)) }))
    .sort((a, b) => (a.neighborhoodId === null ? 1 : b.neighborhoodId === null ? -1 : byLabel(a.label, b.label)))
}

/** La búsqueda guardada de la fila: la más reciente de sus locales (todos reciben la misma). */
export function rowSearch(row: MissingRow, searches: Record<string, StoredPlaceSearch[]>): StoredPlaceSearch | null {
  let latest: StoredPlaceSearch | null = null
  for (const owner of row.owners) {
    const search = searches[owner.discountPlaceId]?.find((item) => item.locationIndex === owner.locationIndex)
    if (search && (!latest || search.searchedAt > latest.searchedAt)) latest = search
  }
  return latest
}
