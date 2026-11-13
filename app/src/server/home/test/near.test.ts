import { describe, expect, it } from 'vitest'
import type { CandidateRow } from '../../search/candidates'
import { everyDay, fakeCache, fakeStore, row } from '../../search/test/fixtures'
import { assembleHome } from '../assemble'
import { homeNearRow, NEAR_HREF } from '../near'

// Lunes 12/10/2026 13:00 en Montevideo.
const now = new Date('2026-10-12T16:00:00Z')
// Cookie `loc` en Cordón (redondeada a 3 decimales).
const CORDON = '-34.901,-56.164'

/**
 * Un lugar a `m` metros al norte del origen: la coordenada (con la que la fila ordena) y la distancia que devuelve la
 * base (con la que el store en memoria filtra por radio, como ST_DWithin).
 */
const at = (id: string, m: number, hours: CandidateRow['hours'] = everyDay('08:00', '23:59')) =>
  row({ id, lat: -34.901 + m / 111_195, lng: -56.164, distance: m, hours, neighborhoodId: `N${id}` })

const deps = (places: CandidateRow[]) => {
  const { store, calls } = fakeStore(places)
  return { deps: { store, cache: fakeCache().cache }, calls }
}

describe('"Abierto ahora cerca tuyo"', () => {
  it('sin coordenadas en la cookie (sin cookie, denied o skip) no sale ni busca', async () => {
    for (const cookie of [null, 'denied', 'skip', 'basura']) {
      const { deps: d, calls } = deps([at('a', 100)])
      expect(await homeNearRow(d, cookie, now)).toBeNull()
      expect(calls).toEqual([])
    }
  })

  it('con la ubicación fuera de Montevideo no sale', async () => {
    expect(await homeNearRow(deps([at('a', 100)]).deps, '-34.603,-58.381', now)).toBeNull()
  })

  it('sólo los abiertos ahora (ni los que abren más tarde ni los sin horario), del más cercano al más lejano, con la distancia', async () => {
    const { deps: d, calls } = deps([
      at('far', 900),
      at('near', 100),
      at('mid', 400),
      at('later', 200, { slots: [{ day: 1, opens: '20:00', closes: '23:59' }], status: 'exact' }),
      at('closed', 200, { slots: [{ day: 1, opens: '08:00', closes: '12:00' }], status: 'exact' }),
      at('unknown', 50, { slots: [], status: 'none' }),
    ])
    const result = await homeNearRow(d, CORDON, now)
    expect(result?.id).toBe('near')
    expect(result?.title).toBe('Abierto ahora cerca tuyo')
    expect(result?.places.map((place) => place.id)).toEqual(['near', 'mid', 'far'])
    expect(result?.places.every((place) => place.distance?.startsWith('a '))).toBe(true)
    expect(result?.href).toBe(NEAR_HREF)
    expect(NEAR_HREF).toBe('/search?f=open%3Atoday&loc=near')
    // Sin texto: sólo SQL, siempre con "Abre hoy" y desde la ubicación de la cookie.
    expect(calls.every((call) => call.filters.openAt?.today)).toBe(true)
  })

  it('si nada abre hoy, la fila queda vacía (no muestra cerrados)', async () => {
    const closed = { slots: [{ day: 1, opens: '08:00', closes: '12:00' }], status: 'exact' as const }
    const result = await homeNearRow(deps([at('a', 100, closed), at('b', 200, closed)]).deps, CORDON, now)
    expect(result?.places ?? []).toEqual([])
  })

  it('va antes de "Para vos" con las reglas de siempre: sus lugares no se repiten abajo', async () => {
    const places = ['a', 'b', 'c', 'd', 'e'].map((id, index) => at(id, 100 * (index + 1)))
    const near = (await homeNearRow(deps(places).deps, CORDON, now))!
    const forYou = { id: 'for_you', title: 'Para vos', places: near.places, href: null }
    const rows = assembleHome([near, forYou])
    expect(rows.map((entry) => entry.id)).toEqual(['near'])
  })
})
