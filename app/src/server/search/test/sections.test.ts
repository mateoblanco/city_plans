import { describe, expect, it } from 'vitest'
import type { SectionId } from '@shared/sections.ts'
import type { CandidateRow } from '../candidates'
import type { Fused } from '../fuse'
import { emptyInterpretation, validateInterpretation, type Interpretation, type LlmInterpretation } from '../interpretation'
import { runSearch } from '../search'
import { buildSections, notBroadReason, requestedSections, ruleSections, sectionSignals } from '../sections'
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
    expect(notBroadReason(interpretation({ must: { ...must, openAt: 'today' } }), broad)).toBe('horario')
    expect(notBroadReason(interpretation({ exclude: { categories: [], tags: ['pizza'] } }), broad)).toBe('exclude')
    expect(notBroadReason(interpretation(), { pinned: false, subs: 1 })).toBe('sub-filtro')
    expect(notBroadReason(interpretation(), { pinned: false, subs: 0, section: true })).toBe('sección')
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
  it('sin Mejores coincidencias: empieza con los grupos, de 6 como mucho, y lo que sobra va a Más opciones', () => {
    const tags = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [index, ['terrace']]))
    const { sections } = buildSections(ranked(20, tags), ['outdoor'], 'es')
    expect(sections?.map((section) => section.id)).toEqual(['outdoor', 'more'])
    expect(sections?.[0].placeIds).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5'])
    expect(sections?.[1]).toMatchObject({ title: 'Más opciones', placeIds: expect.arrayContaining(['p6', 'p19']) })
    expect(sections?.[1].placeIds).toHaveLength(14)
  })

  it('cada lugar va una sola vez, al grupo con menos lugares (a igual cantidad, el de más prioridad), en el orden del ranking', () => {
    const items = ranked(12, { 3: ['picada', 'terrace'], 4: ['terrace'], 5: ['picada'], 6: ['terrace'], 7: ['tapas'], 8: ['terrace'] })
    const { sections } = buildSections(items, ['share', 'outdoor'], 'es')
    expect(sections?.map((section) => section.id)).toEqual(['share', 'outdoor', 'more'])
    expect(sections?.[0]).toEqual({ id: 'share', title: 'Para compartir', placeIds: ['p3', 'p5', 'p7'], total: 3 })
    expect(sections?.[1].placeIds).toEqual(['p4', 'p6', 'p8'])
    const all = sections!.flatMap((section) => section.placeIds)
    expect(new Set(all).size).toBe(12)
    expect(all).toHaveLength(12)
  })

  it('ningún grupo se queda con todo', () => {
    const tags = Object.fromEntries(Array.from({ length: 11 }, (_, index) => [index, ['picada', 'terrace']]))
    const { sections } = buildSections(ranked(11, tags), ['share', 'outdoor'], 'es')
    expect(sections?.map((section) => section.placeIds.length)).toEqual([6, 5])
  })

  it('con los grupos llenos, el lugar va a Más opciones aunque entre', () => {
    const tags = Object.fromEntries(Array.from({ length: 14 }, (_, index) => [index, ['picada', 'terrace']]))
    const { sections } = buildSections(ranked(14, tags), ['share', 'outdoor'], 'es')
    expect(sections?.map((section) => [section.id, section.placeIds.length])).toEqual([['share', 6], ['outdoor', 6], ['more', 2]])
    expect(sections?.[2].placeIds).toEqual(['p12', 'p13'])
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

  it('los grupos se ordenan por el puntaje promedio y quedan como mucho 5, los de más prioridad', () => {
    const tags: Record<number, string[]> = {}
    for (const index of [3, 4, 5]) tags[index] = ['live_music']
    for (const index of [6, 7, 8]) tags[index] = ['picada']
    for (const index of [9, 10, 11]) tags[index] = ['terrace']
    for (const index of [12, 13, 14]) tags[index] = ['japanese']
    const extra = { 0: { style: 'cuidado' }, 1: { style: 'cuidado' }, 2: { style: 'cuidado' }, 15: { categories: ['grill'] }, 16: { categories: ['bodegon'] }, 17: { categories: ['chiviteria'] } }
    const result = buildSections(ranked(18, tags, extra), ['classics', 'world', 'outdoor', 'share', 'live_music', 'special'], 'es')
    // special tiene los primeros puestos pero es el sexto en prioridad: queda afuera y sus lugares van a Más opciones.
    expect(result.chosen.map((group) => group.id)).toEqual(['live_music', 'share', 'outdoor', 'world', 'classics'])
    expect(result.sections?.at(-1)).toMatchObject({ id: 'more', placeIds: ['p0', 'p1', 'p2'], total: null })
  })

  it('total: cuántos resultados cumplen la regla del grupo, aunque muestre 6 (decide si hay "Ver todos")', () => {
    const tags = Object.fromEntries(Array.from({ length: 14 }, (_, index) => [index, ['picada', 'terrace']]))
    const { sections } = buildSections(ranked(14, tags), ['share', 'outdoor'], 'es')
    expect(sections?.map((section) => [section.id, section.placeIds.length, section.total])).toEqual([['share', 6, 14], ['outdoor', 6, 14], ['more', 2, null]])
  })

  it('Descubrí: menos conocido y más parecido que la mitad de los resultados', () => {
    const extra: Record<number, Partial<CandidateRow>> = {}
    for (let index = 0; index < 12; index++) extra[index] = index < 6 ? { prominence: 0.9, semantic: 0.5 } : { prominence: 0.6, semantic: 0.6 }
    extra[11] = { prominence: 0.6, semantic: 0.3 }
    const { sections } = buildSections(ranked(12, {}, extra), ['discover'], 'en')
    // Descubrí no tiene regla fija: no tiene "Ver todos".
    expect(sections?.[0]).toEqual({ id: 'discover', title: 'Discover', placeIds: ['p6', 'p7', 'p8', 'p9', 'p10'], total: null })
    expect(sections?.[1].title).toBe('More options')
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
    expect(response.debug?.sections.chosen.map((group) => group.id)).toContain(response.sections?.[0].id)
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
    expect(response.sections?.map((section) => section.id)).toEqual(expect.arrayContaining(['outdoor', 'world']))
  })

  it('una búsqueda específica no se agrupa', async () => {
    const { store } = fakeStore(places.map((place) => ({ ...place, tags: [...place.tags, 'pizza'] })))
    const response = await runSearch('pizza', { store, cache: fakeCache().cache }, { now, debug: true })
    expect(response.sections).toBeNull()
    expect(response.debug?.sections.notGrouped).toBe('plato')
  })

  it('"Ver todos" de un grupo (f=section:<id>): la regla del grupo como filtro, sin grupos y con su chip en la barra', async () => {
    const { store } = fakeStore(places)
    const outdoor = await runSearch('comer con amigos', { store, cache: fakeCache().cache }, { now, debug: true, filters: 'section:outdoor' })
    expect(outdoor.results.map((result) => result.id).sort()).toEqual(['r11', 'r2', 'r5', 'r8'])
    expect(outdoor.sections).toBeNull()
    expect(outdoor.debug?.sections.notGrouped).toBe('sección')
    expect(outdoor.bar.extras).toContainEqual({ kind: 'section', id: 'outdoor', label: 'Al aire libre', fromText: false, fromFilter: true })

    // El style también filtra: Descontracturado son los casual (impares).
    const casual = await runSearch('comer con amigos', { store, cache: fakeCache().cache }, { now, filters: 'section:casual' })
    expect(casual.results).toHaveLength(6)
    expect(casual.results.every((result) => Number(result.id.slice(1)) % 2 === 1)).toBe(true)
  })

  it('con menos de 10 resultados, tampoco', async () => {
    const { store } = fakeStore(places.slice(0, 9))
    const response = await runSearch('comer con amigos', { store, cache: fakeCache().cache }, { now, debug: true })
    expect(response.sections).toBeNull()
    expect(response.debug?.sections.notGrouped).toBe('menos de 10 resultados')
  })
})

describe('Clásicos uruguayos', () => {
  it('entra por categoría (parrilla, bodegón, chivitería) o por ícono de parrilla o carne; los tags solos no', () => {
    const items = [
      fused({ id: 'grill', categories: ['grill'] }, 0.1),
      fused({ id: 'bodegon', categories: ['bodegon'] }, 0.099),
      fused({ id: 'chiviteria', categories: ['chiviteria'] }, 0.098),
      fused({ id: 'meat', categories: ['restaurant'], iconCategory: 'meat' }, 0.097),
      fused({ id: 'chivito', categories: ['bar'], tags: ['chivito', 'grilled_meat'] }, 0.096),
      fused({ id: 'uruguaya', categories: ['restaurant'], tags: ['uruguayan', 'milanesa'], iconCategory: 'sandwich' }, 0.095),
    ]
    const { sections } = buildSections(items, ['classics'], 'es')
    expect(sections?.[0]).toMatchObject({ id: 'classics', placeIds: ['grill', 'bodegon', 'chiviteria', 'meat'], total: 4 })
  })

  it('Ver todos filtra con la misma regla', async () => {
    const places = [
      row({ id: 'parrilla', categories: ['restaurant'], iconCategory: 'grill' }),
      row({ id: 'chivito', categories: ['bar', 'restaurant'], tags: ['chivito'] }),
    ]
    const { store, calls } = fakeStore(places)
    const response = await runSearch('comer', { store, cache: fakeCache().cache }, { now, filters: 'section:classics' })
    expect(response.results.map((result) => result.id)).toEqual(['parrilla'])
    expect(calls[0].filters.groups).toContainEqual(expect.objectContaining({ icons: ['grill', 'meat'] }))
  })
})

describe('orden dentro de una sección', () => {
  it('cuenta las señales de la regla y las de bonus, con tope', () => {
    expect(sectionSignals('share', row({ id: 'a', tags: ['picada', 'tapas', 'groups'] }))).toBe(3)
    expect(sectionSignals('share', row({ id: 'b', tags: ['tapas'] }))).toBe(1)
    expect(sectionSignals('casual', row({ id: 'c', style: 'casual' }))).toBe(1)
    expect(sectionSignals('discover', row({ id: 'd', tags: ['tapas'] }))).toBe(0)
  })

  it('Clásicos uruguayos: el ícono de parrilla cuenta como señal y el bonus ordena', () => {
    expect(sectionSignals('classics', row({ id: 'parrilla', categories: ['grill'], iconCategory: 'grill' }))).toBe(2)
    expect(sectionSignals('classics', row({ id: 'bodegon', categories: ['bodegon'], tags: ['milanesa', 'neighborhood_spot'] }))).toBe(3)
    expect(sectionSignals('classics', row({ id: 'bar', categories: ['bar'], tags: ['chivito'] }))).toBe(1)
  })

  it('los mismos lugares en el grupo, primero los que tienen más señales', () => {
    // p0..p5 sólo tapas; p3 además picada y groups: con un puntaje casi igual pasa primero, sin que entre nadie nuevo.
    // Puntajes como los reales (≈ 0,03, a 0,001 uno de otro).
    const tags = [['tapas'], ['tapas'], ['tapas'], ['tapas', 'picada', 'groups'], ['terrace'], ['terrace'], ['terrace'], []]
    const items = tags.map((list, index) => fused({ id: `p${index}`, tags: list, prominence: 0.8 }, 0.03 - index / 1000))
    const { sections } = buildSections(items, ['share', 'outdoor'], 'es')
    const share = sections!.find((section) => section.id === 'share')!
    expect(share.placeIds).toEqual(['p3', 'p0', 'p1', 'p2'])
  })
})
