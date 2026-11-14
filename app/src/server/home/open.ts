import { montevideoNow, type OpenState } from '../search/hours'
import { DISPLAY_LANG, openStateLabel, openStateText } from '../search/labels'
import type { SearchResponse, SearchResult } from '../search/search'

/**
 * Los resultados de una búsqueda de la home con "Abierto ahora" (que ya saca los de horario sin confirmar). Si nada
 * estaba abierto, la búsqueda soltó el horario y trae cerrados: vacío.
 */
export const openNowResults = (response: SearchResponse) =>
  response.relaxed.some((notice) => notice.what === 'openAt') ? [] : response.results.filter((place) => place.openStatus.state === 'open')

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
/** Minutos de `from` a `to`, pasando la medianoche si hace falta. */
const minutesUntil = (from: string, to: string) => (minutes(to) - minutes(from) + 24 * 60) % (24 * 60)

/**
 * Los lugares de una fila con el horario al minuto, en memoria: `since` es el momento con el que se buscó (el inicio del
 * intervalo de la caché, o ahora para las filas de cada persona). Saca los que no estaban abiertos y los que cerraron
 * entre `since` y `now`, y rearma la etiqueta con la hora real ("Cierra pronto · 23:00", "Abierto · cierra 23:00").
 */
export function freshOpen(places: SearchResult[], now: Date, since: Date = now): SearchResult[] {
  const moment = montevideoNow(now)
  const from = montevideoNow(since).time
  const elapsed = minutesUntil(from, moment.time)
  return places.flatMap((place) => {
    if (place.openStatus.state !== 'open') return []
    const { closesAt } = place.openStatus
    if (closesAt !== null && minutesUntil(from, closesAt) <= elapsed) return []
    const state: OpenState = { state: 'open', closesAt }
    const openStatus = { state: 'open' as const, closesAt, label: openStateLabel(state, DISPLAY_LANG, moment, true), ...openStateText(state, DISPLAY_LANG, moment, true) }
    return [{ ...place, openStatus }]
  })
}
