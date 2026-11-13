// Tags con parecidos (shared/tags.ts PARTIAL_TAGS): "al aire libre" también trae terrazas, patios y azoteas, debajo de
// los que tienen el tag. Sólo en el ranking y el filtro: no es un tag implícito.
import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { withPartialTags } from '@shared/tags.ts'
import { SEARCH_CONFIG } from '../config'
import { filterConditions, type CandidateFilters, type CandidateRow } from '../candidates'
import { interpretWithDictionary } from '../dictionary'
import { boostsFor, matchLevelOf, partialTagFit, partialTagShareOf, subPartialTags, type Fused, type FuseContext } from '../fuse'
import { emptyInterpretation } from '../interpretation'
import { normalizeQuery } from '../normalize'
import { buildReasons } from '../reasons'
import { runSearch } from '../search'
import { buildSections } from '../sections'
import { fakeCache, fakeStore, llmOutput, row } from './fixtures'

const now = new Date('2026-10-12T16:00:00Z')
const { partialTag, partialTagShare } = SEARCH_CONFIG.boosts
const context = (overrides: Partial<FuseContext> = {}): FuseContext => ({
  pinnedId: null, dishes: [], categories: [], requestedTags: [], preferTags: [], moments: [], cuisines: [], preferStyle: null, price: [], openAt: null, wantsBest: false, intent: null, section: null, diet: [], preferDiet: [], ...overrides,
})
const filters = (overrides: Partial<CandidateFilters> = {}): CandidateFilters => ({
  categories: [], tags: [], diet: [], neighborhoods: [], venues: [], price: [], openAt: null, excludeCategories: [], excludeTags: [], excludeIcons: [], dishes: [], dishMode: 'dish', near: null, groups: [], ...overrides,
})
const fused = (overrides: Partial<CandidateRow> & { id: string }, score: number): Fused => ({
  row: row(overrides), pinned: false, matchLevel: 'has', dishLevel: 'has', open: null, rrf: score, boosts: {}, baseScore: score, multiplier: 1, score, positionWithoutQuality: 1,
})

const outdoor = row({ id: 'outdoor', tags: ['outdoor'] })
const both = row({ id: 'both', tags: ['outdoor', 'terrace'] })
const terrace = row({ id: 'terrace', tags: ['terrace'] })
const patio = row({ id: 'patio', tags: ['patio'] })
const rooftop = row({ id: 'rooftop', tags: ['rooftop'] })
const inside = row({ id: 'inside', tags: ['wifi'] })

describe('al aire libre: el tag entero, terraza, patio y azotea la mitad', () => {
  it('outdoor acepta terraza, patio y azotea', () => {
    expect(withPartialTags('outdoor')).toEqual(['outdoor', 'terrace', 'patio', 'rooftop'])
    expect(withPartialTags('terrace')).toEqual(['terrace'])
  })

  it('la mitad sólo si el lugar no tiene al aire libre', () => {
    expect(partialTagFit(outdoor, ['outdoor'])).toBe(partialTag)
    expect(partialTagFit(both, ['outdoor'])).toBe(partialTag)
    for (const place of [terrace, patio, rooftop]) expect(partialTagFit(place, ['outdoor'])).toBeCloseTo(partialTag * partialTagShare)
    expect(partialTagFit(inside, ['outdoor'])).toBe(0)
    // Terraza pedida no suma por al aire libre: no es un tag implícito al revés.
    expect(partialTagFit(outdoor, ['terrace'])).toBe(0)
  })

  it('partialTagShareOf: 1 con el tag, partialTagShare con sólo un parecido, 0 sin nada', () => {
    expect(partialTagShareOf(outdoor, 'outdoor')).toBe(1)
    expect(partialTagShareOf(both, 'outdoor')).toBe(1)
    for (const place of [terrace, patio, rooftop]) expect(partialTagShareOf(place, 'outdoor')).toBe(partialTagShare)
    expect(partialTagShareOf(inside, 'outdoor')).toBe(0)
  })

  it('la opción Al aire libre exige outdoor con parecidos: la terraza es maybe', () => {
    expect(subPartialTags('cafes', ['outdoor'])).toEqual(['outdoor'])
    expect(subPartialTags('cafes', ['brunch'])).toEqual([])
    expect(subPartialTags(null, ['outdoor'])).toEqual([])
    expect(matchLevelOf(terrace, [], [], [], [], subPartialTags('eat', ['outdoor']))).toBe('maybe')
  })

  it('suma pedido en must o prefer y en el "Ver todos" de Al aire libre; sin pedirlo, nada', () => {
    expect(boostsFor(outdoor, context({ requestedTags: ['outdoor'] }), null).partialTag).toBe(partialTag)
    expect(boostsFor(terrace, context({ requestedTags: ['outdoor'] }), null).partialTag).toBeCloseTo(partialTag * partialTagShare)
    expect(boostsFor(outdoor, context({ section: 'outdoor' }), null).partialTag).toBe(partialTag)
    expect(boostsFor(outdoor, context({ requestedTags: ['outdoor'], section: 'outdoor' }), null).partialTag).toBe(partialTag)
    expect(boostsFor(terrace, context(), null).partialTag).toBeUndefined()
    expect(boostsFor(outdoor, context({ section: 'share' }), null).partialTag).toBeUndefined()
  })

  it('exigido (must o el "Ver todos"), el que sólo tiene un parecido es maybe; en prefer, no', () => {
    expect(matchLevelOf(outdoor, [], [], [], [], ['outdoor'])).toBe('has')
    expect(matchLevelOf(both, [], [], [], [], ['outdoor'])).toBe('has')
    expect(matchLevelOf(terrace, [], [], [], [], ['outdoor'])).toBe('maybe')
    expect(matchLevelOf(terrace, [])).toBe('has')
  })

  it('SQL: al aire libre exigido es "cualquiera de" outdoor, terraza, patio o azotea', () => {
    const dialect = new PgDialect()
    const [plain, partial] = filterConditions(filters({ tags: ['wifi', 'outdoor'] })).map((condition) => dialect.sqlToQuery(condition))
    expect(plain).toMatchObject({ sql: 'tags @> $1::text[]', params: [['wifi']] })
    expect(partial).toMatchObject({ sql: 'tags && $1::text[]', params: [['outdoor', 'terrace', 'patio', 'rooftop']] })
  })

  it('"mesas afuera", "vereda" y "mesas en la vereda" son al aire libre', () => {
    for (const query of ['al aire libre', 'mesas afuera', 'vereda', 'mesas en la vereda']) {
      expect(interpretWithDictionary(normalizeQuery(query))?.must.tags).toEqual(['outdoor'])
    }
  })

  it('el motivo dice qué tiene: Al aire libre o, si sólo tiene el parecido, Terraza', () => {
    const interpretation = { ...emptyInterpretation(), must: { ...emptyInterpretation().must, tags: ['outdoor'] } }
    const reasons = (place: CandidateRow) => buildReasons(fused(place, 1), { interpretation, dishes: [], dishMode: 'none', intent: null, near: false })
    expect(reasons(outdoor)).toContain('Al aire libre')
    expect(reasons(terrace)).toContain('Terraza')
    expect(reasons(both)).not.toContain('Terraza')
  })

  it('en el grupo Al aire libre, primero los del tag aunque una terraza venga mejor rankeada', () => {
    const items = [
      ...Array.from({ length: 3 }, (_, index) => fused({ id: `t${index}`, tags: ['terrace'] }, 1 - index / 1000)),
      ...Array.from({ length: 3 }, (_, index) => fused({ id: `o${index}`, tags: ['outdoor'] }, 0.99 - index / 1000)),
      ...Array.from({ length: 6 }, (_, index) => fused({ id: `x${index}`, tags: [] }, 0.98 - index / 1000)),
    ]
    const { sections } = buildSections(items, ['outdoor'], 'es')
    expect(sections?.find((section) => section.id === 'outdoor')?.placeIds).toEqual(['o0', 'o1', 'o2', 't0', 't1', 't2'])
  })

  it('búsqueda "al aire libre": entran terrazas y patios, después de los del tag', async () => {
    const places = [
      row({ id: 'terraza-1', name: 'Terraza Uno', categories: ['bar'], tags: ['terrace'], prominence: 0.9 }),
      row({ id: 'patio-1', name: 'Patio Uno', categories: ['cafe'], tags: ['patio'], prominence: 0.9 }),
      row({ id: 'afuera-1', name: 'Afuera Uno', categories: ['bar'], tags: ['outdoor'], prominence: 0.3 }),
      row({ id: 'afuera-2', name: 'Afuera Dos', categories: ['cafe'], tags: ['outdoor', 'terrace'], prominence: 0.3 }),
      row({ id: 'adentro', name: 'Adentro', categories: ['bar'], tags: ['wifi'], prominence: 1 }),
    ]
    const response = await runSearch('al aire libre', { store: fakeStore(places).store, cache: fakeCache(llmOutput({ must: { ...llmOutput().must, tags: ['outdoor'] } })).cache }, { now })
    const ids = response.results.map((result) => result.id)
    expect(ids.slice(0, 2).sort()).toEqual(['afuera-1', 'afuera-2'])
    expect(ids.slice(2).sort()).toEqual(['patio-1', 'terraza-1'])
  })
})
