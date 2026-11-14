import { describe, expect, it } from 'vitest'
import type { SearchResult } from '../../search/search'
import { freshOpen } from '../open'

// Montevideo es UTC−3.
const mvd = (iso: string) => new Date(`${iso}:00-03:00`)

const place = (id: string, state: 'open' | 'closed' | 'unconfirmed', closesAt: string | null = null) =>
  ({ id, openStatus: { state, closesAt, label: 'viejo', tone: 'open', prefix: 'Lunes 20:30: ', status: 'abierto', detail: null } }) as unknown as SearchResult

describe('frescura de "abierto ahora"', () => {
  it('saca los que cerraron desde que se buscó y los que no estaban abiertos', () => {
    const since = mvd('2026-10-12T20:30')
    const now = mvd('2026-10-12T20:38')
    const places = [place('closed-at-35', 'open', '20:35'), place('closes-at-38', 'open', '20:38'), place('later', 'open', '23:00'), place('no-close', 'open'), place('c', 'closed'), place('u', 'unconfirmed')]
    expect(freshOpen(places, now, since).map((item) => item.id)).toEqual(['later', 'no-close'])
  })

  it('cruzando la medianoche: cerrar a la 01:00 no es "ya cerró" a las 23:55', () => {
    const since = mvd('2026-10-12T23:50')
    expect(freshOpen([place('late', 'open', '01:00')], mvd('2026-10-12T23:55'), since).map((item) => item.id)).toEqual(['late'])
    expect(freshOpen([place('late', 'open', '23:52')], mvd('2026-10-12T23:55'), since)).toEqual([])
  })

  it('rearma la etiqueta con la hora real ("Cierra pronto")', () => {
    const since = mvd('2026-10-12T22:30')
    const [late] = freshOpen([place('x', 'open', '23:00')], mvd('2026-10-12T22:38'), since)
    expect(late.openStatus.prefix).toBe('')
    expect(late.openStatus.tone).toBe('closing_soon')
    const [early] = freshOpen([place('x', 'open', '23:00')], mvd('2026-10-12T20:31'), mvd('2026-10-12T20:30'))
    expect(early.openStatus.label).toBe('Abierto · cierra 23:00')
  })

  it('con la caché vieja (de horas antes) tampoco muestra cerrados', () => {
    // Se buscó a las 19:00; a las 23:40 sólo quedan los que siguen abiertos.
    const since = mvd('2026-10-12T19:00')
    const places = [place('at-20', 'open', '20:00'), place('at-23', 'open', '23:00'), place('at-0', 'open', '00:30'), place('no-close', 'open')]
    expect(freshOpen(places, mvd('2026-10-12T23:40'), since).map((item) => item.id)).toEqual(['at-0', 'no-close'])
  })
})
