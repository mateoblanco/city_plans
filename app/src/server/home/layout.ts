import { montevideoNow } from '../search/hours'
import type { SearchResult } from '../search/search'
import { orderNear, reorderByAffinity, type Affinity } from './affinity'
import { assembleHomeWithSaved, type HomeRow } from './assemble'
import { fixedSections, SLOT_SECTIONS, type HomeRowContext, type HomeSectionDef } from './config'
import { freshOpen } from './open'
import { homeSlot } from './slots'

export type HomeParts = {
  saved: HomeRow | null
  /** "Cerca tuyo" con la distancia de cada lugar; null sin ubicación (o fuera de Montevideo, o si falló). */
  near: { row: HomeRow; meters: { place: SearchResult; meters: number }[] } | null
  forYou: { row: HomeRow | null; affinity: Affinity | null } | null
  discounts: HomeRow[]
  /** Los pools cacheados de la franja y de las de siempre, buscados abiertos en `since` (el inicio del intervalo). */
  cached: HomeRow[]
  since: Date
}

/**
 * Las filas cacheadas que tocan en este pedido, en el orden de `defs` (sin las que no cumplen su `when`), con el horario
 * al minuto y el pool reordenado con la afinidad de la persona.
 */
function pickRows(defs: HomeSectionDef[], cached: Map<string, HomeRow>, context: HomeRowContext, now: Date, since: Date, affinity: Affinity | null) {
  return defs
    .filter((def) => !def.when || def.when(context))
    .flatMap((def) => cached.get(def.id) ?? [])
    .map((row) => ({ ...row, places: reorderByAffinity(freshOpen(row.places, now, since), affinity) }))
}

/** "Cerca tuyo" con el horario al minuto, ordenado por distancia (la afinidad desempata dentro de cada banda). */
function freshNear(near: NonNullable<HomeParts['near']>, now: Date, affinity: Affinity | null): HomeRow {
  const fresh = new Map(freshOpen(near.row.places, now).map((place) => [place.id, place]))
  const items = near.meters.flatMap((item) => {
    const place = fresh.get(item.place.id)
    return place ? [{ place, meters: item.meters }] : []
  })
  return { ...near.row, places: orderNear(items, affinity) }
}

/**
 * La home en orden con la hora real (`now`, hora de Montevideo): "Guardados" (todos, sin tocar), "Abierto ahora cerca
 * tuyo", las de la franja de ahora, "Para vos", "Descuentos con <Banco>" y las de siempre (fixedSections). Todas menos
 * "Guardados" sólo con lugares abiertos ahora y, salvo "Para vos" (ya personal) y "cerca tuyo" (manda la distancia),
 * reordenadas con la afinidad de "Para vos" (en memoria). Después assembleHome: sin repetir lugares en este orden, sin
 * cadenas y sin las de menos de 4.
 */
export function layoutHome(parts: HomeParts, now: Date): HomeRow[] {
  const affinity = parts.forYou?.affinity ?? null
  const moment = montevideoNow(now)
  const slot = homeSlot(moment.time)
  const context: HomeRowContext = { day: moment.day, time: moment.time, near: parts.near !== null }
  const cached = new Map(parts.cached.map((row) => [row.id, row]))
  const forYou = parts.forYou?.row ? { ...parts.forYou.row, places: freshOpen(parts.forYou.row.places, now) } : null
  return assembleHomeWithSaved(parts.saved, [
    ...(parts.near ? [freshNear(parts.near, now, affinity)] : []),
    ...pickRows(SLOT_SECTIONS[slot], cached, context, now, parts.since, affinity),
    ...(forYou ? [forYou] : []),
    ...parts.discounts.map((row) => ({ ...row, places: reorderByAffinity(freshOpen(row.places, now), affinity) })),
    ...pickRows(fixedSections(slot), cached, context, now, parts.since, affinity),
  ])
}
