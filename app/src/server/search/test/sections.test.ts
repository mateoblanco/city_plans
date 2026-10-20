import { describe, expect, it } from 'vitest'
import type { SectionId } from '@shared/sections.ts'
import type { CandidateRow } from '../candidates'
import type { Fused } from '../fuse'
import { emptyInterpretation, validateInterpretation, type Interpretation, type LlmInterpretation } from '../interpretation'
import { runSearch } from '../search'
import { buildSections, notBroadReason, requestedSections, ruleSections } from '../sections'
import { fakeCache, fakeStore, llmOutput, row } from './fixtures'

// Lunes 12/10/2026 13:00 en Montevideo.
const now = new Date('2026-10-12T16:00:00Z')

const fused = (overrides: Partial<CandidateRow> & { id: string }, score: number): Fused => ({
  row: row(overrides), pinned: false, matchLevel: 'has', open: null, rrf: score, boosts: {}, baseScore: score, multiplier: 1, score, positionWithoutQuality: 1,
})

/** n lugares con puntaje decreciente; tags[i] le da tags al i-ésimo. */
const ranked = (n: number, tags: Record<number, string[]> = {}, extra: Record<number, Partial<CandidateRow>> = {}) =>
  Array.from({ length: n }, (_, index) => fused({ id: `p${index}`, tags: tags[index] ?? [], prominence: 0.8, ...extra[index] }, 1 - index / 100))

const interpretation = (overrides: Partial<Interpretation> = {}): Interpretation => ({ ...emptyInterpretation(), ...overrides })

describe('cuándo una búsqueda es amplia', () => {
  const broad = { pinned: false, subs: 0 }

  it('la intención, los momentos, el style, el barrio y la vibe no la vuelven específica', () => {
    const value = interpretation({
      intent: 'eat',
      prefer: { categories: [], tags: ['groups'], style: 'casual' },
      vibe: 'lugar para ir con amigos',
      must: { ...emptyInterpretation().must, neighborhoods: ['POCITOS'] },
    })
    expect(notBroadReason(value, broad)).toBeNull()
  })

  it('un nombre, un plato o un filtro obligatorio sí', () => {
    const must = emptyInterpretation().must
    expect(notBroadReason(interpretation(), { pinned: true, subs: 0 })).toBe('nombre')
    expect(notBroadReason(interpretation({ dishes: [{ name: 'pizza', relatedTags: [], relatedCategories: [] }] }), broad)).toBe('plato')
    expect(notBroadReason(interpretation({ must: { ...must, tags: ['terrace'] } }), broad)).toBe('tag obligatorio')
    expect(notBroadReason(interpretation({ must: { ...must, categories: ['cafe'] } }), broad)).toBe('categoría obligatoria')
    expect(notBroadReason(interpretation({ must: { ...must, diet: { vegan: true } } }), broad)).toBe('dieta')
    expect(notBroadReason(interpretation({ must: { ...must, price: ['low'] } }), broad)).toBe('precio')
    expect(notBroadReason(interpretation({ must: { ...must, openAt: 'now' } }), broad)).toBe('horario')
    expect(notBroadReason(interpretation({ exclude: { categories: [], tags: ['pizza'] } }), broad)).toBe('exclude')
    expect(notBroadReason(interpretation(), { pinned: false, subs: 1 })).toBe('sub-filtro')
  })
})

describe('qué grupos se piden', () => {
  it('reglas según la intención y el momento', () => {
    expect(ruleSections(interpretation({ prefer: { categories: [], tags: ['groups'], style: null } }), 'eat')).toEqual(['share', 'casual', 'world', 'discover'])
    expect(ruleSections(interpretation({ prefer: { categories: [], tags: ['date'], style: null } }), 'bars')[0]).toBe('special')
    expect(ruleSections(interpretation(), 'cafes')).toEqual(['outdoor', 'casual', 'special', 'discover'])
  })

  it('se saca el grupo que repite lo pedido', () => {
    const value = interpretation({ prefer: { categories: [], tags: [], style: 'casual' } })
    expect(requestedSections(value, { fromLlm: false, intent: 'bars' }).requested).not.toContain('casual')
    expect(requestedSections(interpretation(), { fromLlm: false, intent: 'bars' }).requested).not.toContain('drinks')
    expect(requestedSections(interpretation({ sections: ['eat', 'outdoor', 'share'] }), { fromLlm: true, intent: 'eat' }).requested).toEqual(['outdoor', 'share'])
  })

  it('los del modelo si dio al menos dos ids válidos; si no, las reglas', () => {
    const value = (sections: SectionId[]) => interpretation({ sections })
    expect(requestedSections(value(['outdoor', 'special']), { fromLlm: true, intent: null })).toEqual({ source: 'llm', requested: ['outdoor', 'special'] })
    expect(requestedSections(value(['outdoor']), { fromLlm: true, intent: null }).source).toBe('rules')
    expect(requestedSections(value(['outdoor', 'special']), { fromLlm: false, intent: null }).source).toBe('rules')
  })

  it('valida los ids del modelo', () => {
    const { interpretation: value, discarded } = validateInterpretation(llmOutput({ sections: ['outdoor', 'rooftops', 'outdoor', ' share '] }))
    expect(value.sections).toEqual(['outdoor', 'share'])
    expect(discarded).toContain('section:rooftops')
  })

  it('una interpretación cacheada sin el campo queda sin grupos', () => {
    const old: Partial<LlmInterpretation> = llmOutput()
    delete old.sections
    expect(validateInterpretation(old as LlmInterpretation).interpretation.sections).toEqual([])
  })
})

describe('cómo se arman', () => {
  it('Mejores coincidencias toma entre 3 y 5 según la cantidad', () => {
    const tags = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [index, ['terrace']]))
    expect(buildSections(ranked(10, tags), ['outdoor'], 'es').sections?.[0].placeIds).toHaveLength(3)
    expect(buildSections(ranked(16, tags), ['outdoor'], 'es').sections?.[0].placeIds).toHaveLength(4)
    expect(buildSections(ranked(20, tags), ['outdoor'], 'es').sections?.[0].placeIds).toHaveLength(5)
  })

  it('cada lugar va una sola vez, al grupo con menos lugares (a igual cantidad, el de más prioridad), en el orden del ranking', () => {
    const items = ranked(12, { 3: ['picada', 'terrace'], 4: ['terrace'], 5: ['picada'], 6: ['terrace'], 7: ['tapas'], 8: ['terrace'] })
    const { sections } = buildSections(items, ['share', 'outdoor'], 'es')
    expect(sections?.map((section) => section.id)).toEqual(['top', 'share', 'outdoor', 'more'])
    expect(sections?.[1]).toEqual({ id: 'share', title: 'Para compartir', placeIds: ['p3', 'p5', 'p7'] })
    expect(sections?.[2].placeIds).toEqual(['p4', 'p6', 'p8'])
    const all = sections!.flatMap((section) => section.placeIds)
    expect(new Set(all).size).toBe(12)
    expect(all).toHaveLength(12)
  })

  it('ningún grupo se queda con todo', () => {
    const tags = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [index, ['picada', 'terrace']]))
    const { sections } = buildSections(ranked(12, tags), ['share', 'outdoor'], 'es')
    expect(sections?.slice(1).map((section) => section.placeIds.length)).toEqual([5, 4])
  })

  it('un grupo con menos de 3 se descarta y sus lugares se reparten', () => {
    // share sólo podría tener p3 y p4: se descarta (con p3) y outdoor se queda con p4, p5 y p6.
    const items = ranked(12, { 3: ['picada'], 4: ['picada', 'terrace'], 5: ['terrace'], 6: ['terrace'] })
    const result = buildSections(items, ['share', 'outdoor'], 'es')
    expect(result.dropped).toEqual([{ id: 'share', count: 1 }])
    expect(result.sections?.find((section) => section.id === 'outdoor')?.placeIds).toEqual(['p4', 'p5', 'p6'])
  })

  it('sin ningún grupo que llegue al mínimo, la lista de siempre', () => {
    expect(buildSections(ranked(12, { 3: ['picada'] }), ['share'], 'es').sections).toBeNull()
  })

  it('los grupos se ordenan por el puntaje promedio y quedan como mucho 4', () => {
    const tags: Record<number, string[]> = {}
    for (const index of [3, 4, 5]) tags[index] = ['live_music']
    for (const index of [6, 7, 8]) tags[index] = ['picada']
    for (const index of [9, 10, 11]) tags[index] = ['terrace']
    for (const index of [12, 13, 14]) tags[index] = ['japanese']
    for (const index of [15, 16, 17]) tags[index] = ['uruguayan']
    const result = buildSections(ranked(18, tags), ['classics', 'world', 'outdoor', 'share', 'live_music'], 'es')
    expect(result.chosen.map((group) => group.id)).toEqual(['share', 'outdoor', 'world', 'classics'])
  })

  it('Descubrí: menos conocido y más parecido que la mitad de los resultados', () => {
    const extra: Record<number, Partial<CandidateRow>> = {}
    for (let index = 0; index < 12; index++) extra[index] = index < 6 ? { prominence: 0.9, semantic: 0.5 } : { prominence: 0.6, semantic: 0.6 }
    extra[11] = { prominence: 0.6, semantic: 0.3 }
    const { sections } = buildSections(ranked(12, {}, extra), ['discover'], 'en')
    expect(sections?.[1]).toEqual({ id: 'discover', title: 'Discover', placeIds: ['p6', 'p7', 'p8', 'p9', 'p10'] })
    expect(sections?.[2].title).toBe('More options')
  })
})

describe('en la búsqueda', () => {
  const places = Array.from({ length: 12 }, (_, index) => row({
    id: `r${index}`,
    categories: ['restaurant'],
    tags: index % 3 === 0 ? ['picada', 'groups'] : index % 3 === 1 ? ['japanese'] : ['terrace'],
    style: index % 2 ? 'casual' : 'cuidado',
    prominence: 0.5 + index / 50,
  }))

  it('"comer con amigos" se agrupa por reglas, con cada lugar una sola vez', async () => {
    const { store } = fakeStore(places)
    const response = await runSearch('comer con amigos', { store, cache: fakeCache().cache }, { now, debug: true })
    expect(response.results).toHaveLength(12)
    expect(response.sections?.[0].id).toBe('top')
    const ids = response.sections!.flatMap((section) => section.placeIds)
    expect([...ids].sort()).toEqual(response.results.map((result) => result.id).sort())
    expect(response.debug?.sections.source).toBe('rules')
    expect(response.debug?.sections.notGrouped).toBeNull()
  })

  it('con el modelo, sus grupos', async () => {
    const { store } = fakeStore(places)
    const cache = fakeCache(llmOutput({ prefer: { categories: [], tags: ['date'] }, sections: ['outdoor', 'world'] })).cache
    const response = await runSearch('algo lindo para una cita', { store, cache }, { now, debug: true })
    expect(response.debug?.sections).toMatchObject({ source: 'llm', requested: ['outdoor', 'world'], notGrouped: null })
    expect(response.sections?.map((section) => section.id)).toEqual(expect.arrayContaining(['top', 'outdoor', 'world']))
  })

  it('una búsqueda específica no se agrupa', async () => {
    const { store } = fakeStore(places.map((place) => ({ ...place, tags: [...place.tags, 'pizza'] })))
    const response = await runSearch('pizza', { store, cache: fakeCache().cache }, { now, debug: true })
    expect(response.sections).toBeNull()
    expect(response.debug?.sections.notGrouped).toBe('plato')
  })

  it('con menos de 10 resultados, tampoco', async () => {
    const { store } = fakeStore(places.slice(0, 9))
    const response = await runSearch('comer con amigos', { store, cache: fakeCache().cache }, { now, debug: true })
    expect(response.sections).toBeNull()
    expect(response.debug?.sections.notGrouped).toBe('menos de 10 resultados')
  })
})
