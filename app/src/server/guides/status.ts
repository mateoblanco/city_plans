import type { Hours } from '../search/hours'
import { placeOpenText } from '@/components/pages/PlacePage/utils/summary'
import { MINUTES_PER_WEEK, type WeekStatus } from '@/lib/week-status'

const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

/**
 * El estado de cada minuto de la semana con los textos de la ficha (placeOpenText con los horarios de la base, sin
 * Google), comprimido en tramos: sólo cambia al abrir, al cerrar, en los umbrales de "pronto" y a la medianoche
 * ("Abre mañana" pasa a "Abre hoy"). Sin horario confirmado, un solo tramo sin estado.
 */
export function weekStatus(hours: Hours): WeekStatus {
  const texts: WeekStatus['texts'] = []
  const keys = new Map<string, number>()
  const at: WeekStatus['at'] = []
  let last: number | null = null
  for (let minute = 0; minute < MINUTES_PER_WEEK; minute++) {
    const text = placeOpenText(hours, null, { day: Math.floor(minute / 1440), time: clock(minute % 1440) })
    let index = -1
    if (text) {
      const key = JSON.stringify(text)
      index = keys.get(key) ?? -1
      if (index < 0) {
        index = texts.push(text) - 1
        keys.set(key, index)
      }
    }
    if (index !== last) {
      at.push([minute, index])
      last = index
    }
  }
  return { texts, at }
}
