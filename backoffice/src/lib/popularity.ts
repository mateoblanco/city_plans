import { EVENT_ORIGINS, type EventOrigin } from '@/data/events'
import type { PopularityRow } from '@/types/popularity'

export const POPULARITY_SORTS = ['name', 'views7', 'views30', 'saves7', 'saves30', 'directions7', 'directions30'] as const
export type PopularitySort = (typeof POPULARITY_SORTS)[number]
export type SortDirection = 'asc' | 'desc'

export const ORIGIN_LABELS: Record<EventOrigin, string> = {
  search: 'Búsqueda',
  home: 'Home',
  saved: 'Guardados',
  similar: 'Similares',
  branch: 'Sucursales',
  direct: 'Directo',
}

const collator = new Intl.Collator('es', { sensitivity: 'base' })

/** Ordena en el cliente; a igual valor, por nombre. */
export function sortPopularity(rows: readonly PopularityRow[], sort: PopularitySort, direction: SortDirection): PopularityRow[] {
  const sign = direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const byName = collator.compare(a.name, b.name)
    if (sort === 'name') return sign * byName || a.id.localeCompare(b.id)
    return sign * (a[sort] - b[sort]) || byName
  })
}

/** Al tocar una columna: la misma invierte el sentido; otra arranca de mayor a menor (el nombre, de la A a la Z). */
export function nextSort(current: { sort: PopularitySort; direction: SortDirection }, sort: PopularitySort) {
  if (current.sort === sort) return { sort, direction: current.direction === 'asc' ? 'desc' : 'asc' } as const
  return { sort, direction: sort === 'name' ? 'asc' : 'desc' } as const
}

/** Orígenes de las vistas con su porcentaje, de más a menos; sin vistas, vacío. */
export function originShares(origins: PopularityRow['origins']): { origin: EventOrigin; label: string; count: number; percent: number }[] {
  const total = EVENT_ORIGINS.reduce((sum, origin) => sum + (origins[origin] ?? 0), 0)
  if (total === 0) return []
  return EVENT_ORIGINS.filter((origin) => (origins[origin] ?? 0) > 0)
    .map((origin) => ({ origin, label: ORIGIN_LABELS[origin], count: origins[origin]!, percent: Math.round(((origins[origin] ?? 0) / total) * 100) }))
    .sort((a, b) => b.count - a.count)
}
