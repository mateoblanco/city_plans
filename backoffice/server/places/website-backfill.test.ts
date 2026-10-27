import { describe, expect, it } from 'vitest'
import type { Source } from '../providers/place-extraction-service.ts'
import { computeProminence } from './prominence.ts'
import { checkSavedWebsites, type WebsiteRow } from './website-backfill.ts'

const MEDIAN = 0.8

function row(id: string, website: string | null, overrides: Partial<WebsiteRow> = {}): WebsiteRow {
  return {
    id, googlePlaceId: `place-${id}`, name: `Lugar ${id}`, neighborhoodId: 'pocitos', instagram: null, website, igFollowers: 5000,
    chainBranch: false, prominence: computeProminence({ igFollowers: 5000 }, MEDIAN), brandKey: null, manualOverrides: {}, ...overrides,
  }
}

const web = (id: string, url: string, text: string) => ({ googlePlaceId: `place-${id}`, sources: [{ id: 'S1', kind: 'web', trust: 'official', url, text } as Source] })

describe('checkSavedWebsites', () => {
  it('descarta reservas, pedidos y webs de otro país, y dice cómo queda la cadena', () => {
    const rows = [
      row('1', 'https://pausat.setmore.com/'),
      row('2', 'https://pandabar.ambit.la/'),
      row('3', 'https://peperoncinopizzeria.com/', { chainBranch: true, prominence: computeProminence({ igFollowers: 5000, chainBranch: true }, MEDIAN) }),
      row('4', 'https://www.lanuevaroma.com.uy/'),
    ]
    const verdicts = checkSavedWebsites(rows, [web('3', 'https://peperoncinopizzeria.com/', 'Sucursales Cd. Chihuahua'), web('4', 'https://www.lanuevaroma.com.uy/', 'Helados. Montevideo.')], MEDIAN)
    expect(verdicts.map(({ id, kind }) => [id, kind])).toEqual([['1', 'drop'], ['2', 'drop'], ['3', 'drop']])
    expect(verdicts[0].reason).toBe('sistema de reservas (pausat.setmore.com)')
    expect(verdicts[2].chain).toMatchObject({ before: { chainBranch: true }, after: { chainBranch: false } })
    expect(verdicts[0].chain).toBeNull()
  })

  it('separa los dudosos: .com.ar que menciona Montevideo, constructor de sitios extranjero y dominio de otra ciudad', () => {
    const rows = [
      row('1', 'https://www.lapanerarosa.com.ar/'),
      row('2', 'https://lacantinadel258.webnode.es/'),
      row('3', 'https://www.misushipunta.com/'),
      row('4', 'https://kntina.es/'),
      row('5', 'https://www.puntacarretasbar.com.uy/'),
    ]
    const verdicts = checkSavedWebsites(rows, [
      web('1', 'https://www.lapanerarosa.com.ar/', 'La Panera Rosa Montevideo'),
      web('2', 'https://lacantinadel258.webnode.es/', 'La Cantina del 25'),
      web('3', 'https://www.misushipunta.com/', 'Misushi. Sushi en Montevideo.'),
    ], MEDIAN)
    expect(verdicts.map(({ id, kind }) => [id, kind])).toEqual([['1', 'doubtful'], ['2', 'doubtful'], ['3', 'doubtful'], ['4', 'doubtful']])
    expect(verdicts[3].reason).toContain('sin texto de la web')
  })

  it('no toca una web editada a mano', () => {
    expect(checkSavedWebsites([row('1', 'https://wa.me/59899123456', { manualOverrides: { website: 'https://wa.me/59899123456' } })], [], MEDIAN)).toEqual([])
  })
})
