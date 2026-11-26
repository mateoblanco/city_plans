// Al aire libre: terraza, patio y vereda son sinónimos de outdoor (los tags terrace y patio se retiraron) y una azotea
// también lo tiene (IMPLIED_TAGS). Sin puntaje parcial: el filtro y el ranking usan sólo el tag. La azotea sigue siendo
// buscable; para comer en la barra ya no existe.
import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { findDef, HIDDEN_TAGS, IMPLIED_TAGS, RETIRED_TAGS, TAG_FILTERS } from '@shared/tags.ts'
import { filterConditions, type CandidateFilters, type CandidateRow } from '../candidates'
import { interpretWithDictionary } from '../dictionary'
import { boostsFor, matchLevelOf, type Fused, type FuseContext } from '../fuse'
import { emptyInterpretation } from '../interpretation'
import { normalizeQuery } from '../normalize'
import { buildReasons } from '../reasons'
import { runSearch } from '../search'
import { fakeCache, fakeStore, llmOutput, row } from './fixtures'

const now = new Date('2026-10-12T16:00:00Z')
const context = (overrides: Partial<FuseContext> = {}): FuseContext => ({
  pinnedId: null, dishes: [], categories: [], requestedTags: [], preferTags: [], moments: [], cuisines: [], preferStyle: null, price: [], openAt: null, wantsBest: false, intent: null, section: null, diet: [], preferDiet: [], ...overrides,
})
const filters = (overrides: Partial<CandidateFilters> = {}): CandidateFilters => ({
  categories: [], tags: [], diet: [], neighborhoods: [], venues: [], price: [], openAt: null, excludeCategories: [], excludeTags: [], excludeIcons: [], dishes: [], dishMode: 'dish', near: null, groups: [], ...overrides,
})
const fused = (overrides: Partial<CandidateRow> & { id: string }, score: number): Fused => ({
  row: row(overrides), pinned: false, matchLevel: 'has', dishLevel: 'has', open: null, rrf: score, boosts: {}, baseScore: score, multiplier: 1, score, positionWithoutQuality: 1,
})
const mustTags = (query: string) => interpretWithDictionary(normalizeQuery(query))?.must.tags

describe('al aire libre: terraza y patio son sinónimos', () => {
  it('terrace, patio y bar_seating salieron del catálogo: terraza y patio pasan a outdoor, la barra se elimina', () => {
    for (const id of ['terrace', 'patio', 'bar_seating']) expect(findDef(id), id).toBeUndefined()
    expect(RETIRED_TAGS).toMatchObject({ terrace: 'outdoor', patio: 'outdoor', bar_seating: null })
  })

  it('"terraza", "patio", "jardín", "vereda" y los demás sinónimos encuentran al aire libre', () => {
    for (const query of ['al aire libre', 'terraza', 'con terraza', 'patio', 'jardín', 'mesas afuera', 'vereda', 'mesas en la vereda', 'terrace', 'garden']) {
      expect(mustTags(query), query).toEqual(['outdoor'])
    }
  })

  it('el filtro es sólo el tag: ni terrazas ni azoteas sin outdoor', () => {
    expect(TAG_FILTERS.outdoor.tags).toEqual(['outdoor'])
    const [condition] = filterConditions(filters({ tags: ['wifi', 'outdoor'] })).map((value) => new PgDialect().sqlToQuery(value))
    expect(condition).toMatchObject({ sql: 'tags @> $1::text[]', params: [['wifi', 'outdoor']] })
  })

  it('sin puntaje parcial: pedir al aire libre no suma un empujón propio ni deja a nadie en maybe', () => {
    const outdoor = row({ id: 'afuera', tags: ['outdoor'] })
    const boosts = boostsFor(outdoor, context({ requestedTags: ['outdoor'], section: 'outdoor' }), null) as Record<string, number | undefined>
    expect(boosts.partialTag).toBeUndefined()
    expect(matchLevelOf(row({ id: 'adentro', tags: ['wifi'] }), [])).toBe('has')
  })

  it('el motivo dice Al aire libre', () => {
    const interpretation = { ...emptyInterpretation(), must: { ...emptyInterpretation().must, tags: ['outdoor'] } }
    expect(buildReasons(fused({ id: 'afuera', tags: ['outdoor'] }, 1), { interpretation, dishes: [], dishMode: 'none', intent: null, near: false })).toContain('Al aire libre')
  })

  it('búsqueda "terraza": sólo los que tienen al aire libre', async () => {
    const places = [
      row({ id: 'afuera-1', name: 'Afuera Uno', categories: ['bar'], tags: ['outdoor'], prominence: 0.3 }),
      row({ id: 'azotea-1', name: 'Arriba Uno', categories: ['bar'], tags: ['rooftop', 'outdoor'], prominence: 0.5 }),
      row({ id: 'adentro', name: 'Adentro', categories: ['bar'], tags: ['wifi'], prominence: 1 }),
    ]
    const response = await runSearch('terraza', { store: fakeStore(places).store, cache: fakeCache(llmOutput({ must: { ...llmOutput().must, tags: ['outdoor'] } })).cache }, { now })
    expect(response.results.map((result) => result.id).sort()).toEqual(['afuera-1', 'azotea-1'])
  })
})

describe('azotea: oculta en la ficha, viva en la búsqueda', () => {
  it('una azotea es al aire libre y es un tag oculto', () => {
    expect(IMPLIED_TAGS.rooftop).toEqual(['outdoor'])
    expect(HIDDEN_TAGS.has('rooftop')).toBe(true)
  })

  it('"azotea", "rooftop" y "terraza en la azotea" siguen buscando la azotea', () => {
    for (const query of ['azotea', 'rooftop', 'terraza en la azotea']) expect(mustTags(query), query).toEqual(['rooftop'])
  })

  it('pedida, el motivo dice Azotea', () => {
    const interpretation = { ...emptyInterpretation(), must: { ...emptyInterpretation().must, tags: ['rooftop'] } }
    expect(buildReasons(fused({ id: 'arriba', tags: ['rooftop', 'outdoor'] }, 1), { interpretation, dishes: [], dishMode: 'none', intent: null, near: false })).toContain('Azotea')
  })

  it('sin pedirla, el motivo no la nombra', () => {
    const interpretation = { ...emptyInterpretation(), must: { ...emptyInterpretation().must, tags: ['outdoor'] } }
    expect(buildReasons(fused({ id: 'arriba', tags: ['rooftop', 'outdoor'] }, 1), { interpretation, dishes: [], dishMode: 'none', intent: null, near: false })).not.toContain('Azotea')
  })
})

describe('para comer en la barra: retirado', () => {
  it('"comer en la barra" y "barra larga" ya no piden un tag de barra', () => {
    for (const query of ['comer en la barra', 'barra larga', 'barra central']) expect(mustTags(query) ?? [], query).not.toContain('bar_seating')
  })
})
