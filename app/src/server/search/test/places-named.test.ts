import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { candidatesQuery } from '../candidates'
import { applyDictionary } from '../dictionary'
import { emptyInterpretation, validateInterpretation } from '../interpretation'
import { normalizeQuery } from '../normalize'
import { runSearch } from '../search'
import { applyVenues, venuesIn, type Venue } from '../venues'
import { fakeCache, fakeStore, llmOutput, row } from './fixtures'

// Lunes 12/10/2026 13:00 en Montevideo.
const now = new Date('2026-10-12T16:00:00Z')
const dialect = new PgDialect()

const PUERTO = { lat: -34.9069, lng: -56.2117 }
const VENUES: Venue[] = [
  { name: 'Mercado del Puerto', points: [PUERTO] },
  { name: 'Mercado Ferrando', points: [{ lat: -34.9037, lng: -56.1712 }, { lat: -34.9203, lng: -56.1573 }] },
  { name: 'Punta Carretas Shopping', points: [{ lat: -34.9238, lng: -56.1588 }] },
]
const names = (text: string) => venuesIn(normalizeQuery(text), VENUES).venues.map((venue) => venue.name)
const neighborhoodsOf = (text: string, neighborhoods: string[]) =>
  validateInterpretation(llmOutput({ must: { ...llmOutput().must, neighborhoods } }), normalizeQuery(text))

describe('barrios del modelo', () => {
  it('sólo se aceptan si el texto los nombra; si no, quedan sin reconocer', () => {
    const { interpretation, notNamed } = neighborhoodsOf('comer en el Mercado del Puerto', ['MERCADO MODELO Y BOLIVAR'])
    expect(interpretation.must.neighborhoods).toEqual([])
    expect(notNamed).toEqual(['MERCADO MODELO Y BOLIVAR'])
    expect(interpretation.unrecognized).toEqual(['MERCADO MODELO Y BOLIVAR'])
  })

  it('aceptan variantes: tildes, mayúsculas, artículos y alias', () => {
    expect(neighborhoodsOf('parrilla en Ciudad Vieja', ['Ciudad Vieja']).interpretation.must.neighborhoods).toEqual(['CIUDAD VIEJA'])
    expect(neighborhoodsOf('cafe en cordon', ['Cordón']).interpretation.must.neighborhoods).toEqual(['CORDON'])
    expect(neighborhoodsOf('algo por el prado', ['Prado Nueva Savona']).interpretation.must.neighborhoods).toEqual(['PRADO NUEVA SAVONA'])
    expect(neighborhoodsOf('pizza in old town', ['CIUDAD VIEJA']).interpretation.must.neighborhoods).toEqual(['CIUDAD VIEJA'])
  })

  it('un lugar que el modelo puso como barrio y no existe queda sin reconocer', () => {
    const { interpretation, discarded } = neighborhoodsOf('comer en el mercado del puerto', ['Mercado del Puerto'])
    expect(discarded).toEqual(['Mercado del Puerto'])
    expect(interpretation.unrecognized).toEqual(['Mercado del Puerto'])
  })
})

describe('venues (located_in)', () => {
  it('se reconocen sin tildes, mayúsculas ni artículos', () => {
    expect(names('comer en el Mercado del Puerto')).toEqual(['Mercado del Puerto'])
    expect(names('algo en mercado ferrando')).toEqual(['Mercado Ferrando'])
    expect(names('MERCADO PUERTO')).toEqual(['Mercado del Puerto'])
    expect(names('almuerzo en el punta carretas shopping')).toEqual(['Punta Carretas Shopping'])
  })

  it('no se confunden con barrios ni con palabras sueltas', () => {
    expect(names('algo en punta carretas')).toEqual([])
    expect(names('comer cerca del mercado modelo')).toEqual([])
    expect(names('pescado del puerto')).toEqual([])
  })

  it('el venue sale de unrecognized y del nombre, y se lleva el barrio que sólo es parte de su nombre', () => {
    const value = emptyInterpretation()
    value.unrecognized = ['en el mercado del puerto']
    value.nameQuery = 'mercado del puerto'
    const done = applyVenues(value, 'comer en el mercado del puerto', VENUES)
    expect(done.interpretation.must.venues).toEqual(['Mercado del Puerto'])
    expect(done.interpretation.unrecognized).toEqual([])
    expect(done.interpretation.nameQuery).toBeNull()

    const shopping = { ...emptyInterpretation(), must: { ...emptyInterpretation().must, neighborhoods: ['PUNTA CARRETAS'] } }
    const inside = applyVenues(shopping, 'cafe en punta carretas shopping', VENUES)
    expect(inside.interpretation.must.neighborhoods).toEqual([])
    expect(inside.discarded.map((entry) => entry.value)).toEqual(['neighborhood:PUNTA CARRETAS'])
    // Nombrado aparte, el barrio se queda.
    expect(applyVenues(shopping, 'punta carretas shopping o punta carretas', VENUES).interpretation.must.neighborhoods).toEqual(['PUNTA CARRETAS'])
  })

  it('el filtro: sus locales o, sin located_in, a menos del radio de uno de ellos', () => {
    const query = dialect.sqlToQuery(
      candidatesQuery(
        { categories: [], tags: [], diet: [], neighborhoods: [], venues: [VENUES[1]], price: [], openAt: null, excludeCategories: [], excludeTags: [], excludeIcons: [], dishes: [], dishMode: 'dish', near: null, groups: [] },
        { embedding: null, keywords: [], name: null, origins: [], pinnedId: null },
      ),
    )
    expect(query.sql).toContain('located_in = any($')
    expect(query.sql).toContain('located_in is null and (ST_DWithin(location, ST_SetSRID(ST_MakePoint($')
    // Dos puntos, y la condición va dos veces (matchesFilters y where).
    expect(query.sql.match(/ST_DWithin/g)).toHaveLength(4)
    expect(query.params).toContainEqual(['Mercado Ferrando'])
    expect(query.params).toContain(100)
  })
})

describe('venue en la búsqueda', () => {
  // A 0, ~60 y ~150 m del local del Mercado; otro venue a 50 m no entra por cercanía.
  const places = [
    row({ id: 'palenque', neighborhoodId: 'CIUDAD VIEJA', locatedIn: 'Mercado del Puerto', ...PUERTO }),
    row({ id: 'planta-baja', neighborhoodId: 'CIUDAD VIEJA', lat: PUERTO.lat, lng: PUERTO.lng + 0.00066 }),
    row({ id: 'lejos', neighborhoodId: 'CIUDAD VIEJA', lat: PUERTO.lat, lng: PUERTO.lng + 0.00165 }),
    row({ id: 'otro-venue', neighborhoodId: 'CIUDAD VIEJA', locatedIn: 'Distrito El Globo', lat: PUERTO.lat + 0.00045, lng: PUERTO.lng }),
    row({ id: 'bar-lejos', neighborhoodId: 'CENTRO', categories: ['bar'], lat: -34.9055, lng: -56.1913 }),
  ]

  it('"comer en el Mercado del Puerto": sin el barrio que inventó el modelo, chip y filtro por el venue', async () => {
    const { store, calls } = fakeStore(places)
    const { cache } = fakeCache(llmOutput({ must: { ...llmOutput().must, neighborhoods: ['MERCADO MODELO Y BOLIVAR'] }, intent: 'eat' }))
    const response = await runSearch('comer en el Mercado del Puerto', { store, cache }, { now, debug: true })
    expect(calls[0].filters.neighborhoods).toEqual([])
    expect(calls[0].filters.venues.map((venue) => venue.name)).toEqual(['Mercado del Puerto'])
    expect(response.interpreted.chips).toContainEqual({ kind: 'venue', id: 'Mercado del Puerto', label: 'En Mercado del Puerto', fromText: true, fromFilter: false })
    expect(response.results.map((result) => result.id).sort()).toEqual(['palenque', 'planta-baja'])
    expect(response.debug!.discarded).toContainEqual({ value: 'MERCADO MODELO Y BOLIVAR', reason: 'el texto no nombra el barrio: va como no reconocido' })
    expect(response.debug!.interpretation.unrecognized).toEqual([])
    expect(response.relaxed).toEqual([])
  })

  it('los vecinos sin located_in no se cortan por similitud: pasaron el filtro del venue', async () => {
    const near = places.map((place) => ({ ...place, semantic: place.id === 'palenque' ? 0.6 : 0.3 }))
    const { store } = fakeStore(near)
    const { cache } = fakeCache(llmOutput())
    const response = await runSearch('algo en el mercado del puerto', { store, cache }, { now, debug: true })
    expect(response.results.map((result) => result.id).sort()).toEqual(['palenque', 'planta-baja'])
    expect(response.debug!.results.find((result) => result.id === 'planta-baja')!.relevance).toEqual({ kept: 'venue' })
  })

  it('sin nada en el venue, se relaja ordenando por distancia a sus locales', async () => {
    const { store, calls } = fakeStore(places)
    const { cache } = fakeCache(llmOutput({ must: { ...llmOutput().must, categories: ['bar'] } }))
    const response = await runSearch('bar en el mercado del puerto porfa', { store, cache }, { now })
    const relaxedAt = calls.findIndex((call) => call.filters.venues.length === 0)
    expect(relaxedAt).toBeGreaterThan(0)
    expect(calls[relaxedAt].scores.origins).toEqual([PUERTO])
    expect(response.results.map((result) => result.id)).toEqual(['bar-lejos'])
    expect(response.relaxed).toEqual([{ what: 'venue', message: 'No encontramos en Mercado del Puerto; estos están cerca.' }])
  })

  it('remove=venue:… lo saca', async () => {
    const { store, calls } = fakeStore(places)
    await runSearch('comer en el mercado del puerto', { store, cache: fakeCache(llmOutput({ intent: 'eat' })).cache }, { now, remove: 'venue:Mercado del Puerto' })
    expect(calls[0].filters.venues).toEqual([])
  })

  it('un venue que no existe queda sin reconocer, para la búsqueda semántica', async () => {
    const { store, calls } = fakeStore(places)
    const { cache } = fakeCache(llmOutput({ unrecognized: ['mercado agricola'] }))
    const response = await runSearch('algo en el mercado agricola', { store, cache }, { now, debug: true })
    expect(calls[0].filters.venues).toEqual([])
    expect(response.debug!.interpretation.unrecognized).toEqual(['mercado agricola'])
    expect(response.debug!.semanticText).toBe('algo en el mercado agricola')
  })
})

describe('frases del diccionario sobre el modelo', () => {
  it('"cerca de la rambla" es vista al mar como preferencia, y deja de estar sin reconocer', () => {
    const value = { ...emptyInterpretation(), must: { ...emptyInterpretation().must, neighborhoods: ['PUNTA CARRETAS'] }, unrecognized: ['cerca de la rambla'] }
    const done = applyDictionary(value, 'algo cerca de la rambla en punta carretas')
    expect(done.prefer.tags).toEqual(['sea_view'])
    expect(done.unrecognized).toEqual([])
    expect(done.must.neighborhoods).toEqual(['PUNTA CARRETAS'])
  })

  it('sobre la costa y cerca del mar también; si el modelo la exigió, pasa a preferencia', () => {
    const value = { ...emptyInterpretation(), must: { ...emptyInterpretation().must, tags: ['sea_view'] } }
    for (const text of ['cafe sobre la costa', 'algo cerca del mar']) {
      const done = applyDictionary(value, text)
      expect(done.must.tags).toEqual([])
      expect(done.prefer.tags).toEqual(['sea_view'])
    }
  })

  it('suma comidas del día, momentos y estilo; no lo negado ni "cerca mío"', () => {
    const done = applyDictionary(emptyInterpretation(), 'cena romantica con amigos')
    expect(done.must.tags).toEqual(['dinner'])
    expect(done.prefer.tags.sort()).toEqual(['date', 'groups'])
    expect(done.prefer.style).toBe('cuidado')
    expect(applyDictionary(emptyInterpretation(), 'algo que no sea frente al mar').prefer.tags).toEqual([])
    const near = applyDictionary({ ...emptyInterpretation(), unrecognized: ['cerca mio'], needsLocation: true }, 'pizza cerca mio')
    expect(near.unrecognized).toEqual(['cerca mio'])
  })

  it('en la búsqueda, con el modelo', async () => {
    const { store } = fakeStore([row({ id: 'a', neighborhoodId: 'PUNTA CARRETAS' })])
    const { cache } = fakeCache(llmOutput({ must: { ...llmOutput().must, neighborhoods: ['Punta Carretas'] }, unrecognized: ['cerca de la rambla'] }))
    const response = await runSearch('algo cerca de la rambla en Punta Carretas', { store, cache }, { now, debug: true })
    expect(response.debug!.source).toBe('llm')
    expect(response.debug!.interpretation.prefer.tags).toContain('sea_view')
    expect(response.debug!.interpretation.unrecognized).toEqual([])
    expect(response.debug!.interpretation.must.neighborhoods).toEqual(['PUNTA CARRETAS'])
  })
})
