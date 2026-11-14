import { describe, expect, it } from 'vitest'
import { interpretWithDictionary } from '../dictionary'
import { showsInBar } from '../labels'
import { normalizeQuery } from '../normalize'
import { runSearch } from '../search'
import { everyDay, fakeCache, fakeStore, row } from './fixtures'

// Lunes 12/10/2026 13:00 en Montevideo.
const now = new Date('2026-10-12T16:00:00Z')
const open = everyDay('08:00', '23:59')
const dictionary = (query: string) => interpretWithDictionary(normalizeQuery(query))

describe('frases de fila (el nombre de una fila de la home en el buscador)', () => {
  const places = [
    row({ id: 'resto-cita', categories: ['restaurant'], tags: ['date', 'dinner'], hours: open }),
    row({ id: 'bar-after', categories: ['bar'], tags: ['after_office', 'drinks'], hours: open }),
    row({ id: 'resto-after', categories: ['restaurant'], tags: ['after_office', 'pizza'], hours: open }),
    row({ id: 'cafe', categories: ['cafe'], tags: ['breakfast'], hours: open }),
  ]

  it('exige los tags de la fila, sin tidy: un momento queda exigido como con tag: en la URL', () => {
    expect(dictionary('Salida en pareja')).toMatchObject({ rowPhrase: true, must: { tags: ['date'] }, prefer: { tags: [] } })
    expect(dictionary('salida en pareja')?.must.tags).toEqual(['date'])
    // Escrito de otra forma o con algo más, el camino de siempre ("cita" y "en pareja" son preferencia).
    expect(dictionary('en pareja')?.prefer.tags).toEqual(['date'])
    expect(dictionary('salida en pareja en cordón')).toBeNull()
  })

  it('busca como la fila: sin modelo, embedding ni palabras clave, y sin chip que repita el texto', async () => {
    const { cache, interpreted, embedded } = fakeCache()
    const { store, calls } = fakeStore(places)
    const response = await runSearch('Salida en pareja', { store, cache }, { now, filters: 'open:now', loc: 'all' })
    expect(response.results.map((result) => result.id)).toEqual(['resto-cita'])
    expect(interpreted).toEqual([])
    expect(embedded).toEqual([])
    expect(calls[0].scores.keywords).toEqual([])
    expect(calls[0].scores.embedding).toBeNull()
    expect(response.bar.extras.filter(showsInBar)).toEqual([])
  })

  it('"after office" trae la intención de la fila (ninguna), no Bares', async () => {
    const response = await runSearch('After office', { store: fakeStore(places).store, cache: fakeCache().cache }, { now, filters: 'open:now', loc: 'all' })
    expect(response.bar.intent).toBeNull()
    expect(response.results.map((result) => result.id).sort()).toEqual(['bar-after', 'resto-after'])
  })

  it('sin ningún lugar con el tag, se relaja como cualquier tag exigido (pasa a preferencia)', async () => {
    const { store, calls } = fakeStore(places)
    const response = await runSearch('Juntada con amigos', { store, cache: fakeCache().cache }, { now, filters: 'open:now', loc: 'all' })
    // Primero exige groups (nadie lo tiene); después, como cualquier tag exigido, va a preferencia.
    expect(calls.map((call) => call.filters.tags)).toEqual([['groups'], []])
    expect(response.results.length).toBe(places.length)
  })

  it('los chips del texto que agregan información se siguen mostrando ("cenar hoy" → "Esta noche")', async () => {
    const response = await runSearch('cenar hoy', { store: fakeStore(places).store, cache: fakeCache().cache }, { now })
    expect(response.bar.extras.filter(showsInBar).map((chip) => chip.label)).toEqual(['Esta noche'])
  })
})

describe('showsInBar', () => {
  it('se ven los de la URL y el horario escrito; lo demás del texto ya está en el buscador', () => {
    expect(showsInBar({ kind: 'tag', id: 'date', fromFilter: true })).toBe(true)
    expect(showsInBar({ kind: 'section', id: 'world', fromFilter: true })).toBe(true)
    expect(showsInBar({ kind: 'openAt', id: 'tonight', fromFilter: false })).toBe(true)
    expect(showsInBar({ kind: 'openAt', id: 'today' })).toBe(true)
    expect(showsInBar({ kind: 'tag', id: 'date', fromFilter: false })).toBe(false)
    expect(showsInBar({ kind: 'prefer', id: 'date' })).toBe(false)
    expect(showsInBar({ kind: 'dish', id: 'pizza' })).toBe(false)
  })
})
