import { describe, expect, it, vi } from 'vitest'
import { applySearchTextChanges, planMomentsChange, planStyleChange, planTagsChange, type SearchTextRow } from './search-text-backfill.ts'

const row = (overrides: Partial<SearchTextRow> = {}): SearchTextRow => ({
  id: 'uuid-1',
  googlePlaceId: 'place-1',
  name: 'Brujona',
  neighborhoodId: 'POCITOS',
  descriptionEs: 'Bar de barrio con pizzas.',
  descriptionEn: 'Neighborhood bar with pizzas.',
  locatedIn: null,
  categories: ['bar'],
  tags: ['pizza'],
  dietVegan: 'unknown',
  dietVegetarian: 'unknown',
  dietGlutenFree: 'unknown',
  highlights: [],
  dishes: ['muzzarella'],
  signature: [],
  style: null,
  manualOverrides: {},
  ...overrides,
})

const byIcon = { style: 'casual' as const, tagEvidence: [{ tag: 'casual', mode: 'inferred' as const, basis: 'icon' as const, signals: ['ícono: pizza'], factIds: [] }] }

describe('planStyleChange', () => {
  it('arma el cambio con los textos de búsqueda del lugar guardado y el style nuevo, y estima el embedding', () => {
    const change = planStyleChange(row(), byIcon)!
    expect(change).toMatchObject({ name: 'Brujona', before: null, after: 'casual', basis: 'icon', skipped: false })
    expect(change.embeddingText).toContain('Estilo casual')
    expect(change.embeddingText).toContain('Bar de barrio con pizzas')
    expect(change.keywordText).toContain('muzzarella')
    expect(change.keywordText).toContain('descontracturado')
    expect(change.estimatedEmbeddingUsd).toBeGreaterThan(0)
    expect(change.estimatedEmbeddingUsd).toBeLessThan(0.0001)
  })

  it('no cambia si el style es el mismo o el replay no da ninguno', () => {
    expect(planStyleChange(row({ style: 'casual' }), byIcon)).toBeNull()
    expect(planStyleChange(row(), { style: null })).toBeNull()
  })

  it('un style editado a mano no se toca', () => {
    expect(planStyleChange(row({ style: 'cuidado', manualOverrides: { style: 'cuidado' } }), byIcon))
      .toMatchObject({ skipped: true, keywordText: null, embeddingText: null, estimatedEmbeddingUsd: 0 })
    // Otros campos editados no impiden cambiar el style; los textos salen de los valores guardados (los finales).
    const named = planStyleChange(row({ name: 'Brujona Bar', manualOverrides: { name: 'Brujona Bar' } }), byIcon)!
    expect(named).toMatchObject({ skipped: false })
    expect(named.embeddingText).toContain('Brujona Bar')
  })
})

describe('applySearchTextChanges', () => {
  it('escribe sólo style, los textos y el embedding; saltea los overrides de style', async () => {
    const write = vi.fn(async () => {})
    const embed = vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2]))
    const changes = [planStyleChange(row(), byIcon)!, planStyleChange(row({ id: 'uuid-2', manualOverrides: { style: null } }), byIcon)!]
    const now = new Date('2026-10-20T12:00:00.000Z')
    expect(await applySearchTextChanges(changes, { write, embed, now: () => now })).toEqual({ written: 1, embedError: null })
    expect(embed).toHaveBeenCalledWith([changes[0].embeddingText])
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith('uuid-1', {
      style: 'casual',
      keywordText: changes[0].keywordText,
      embeddingText: changes[0].embeddingText,
      embedding: [0.1, 0.2],
      embeddingModel: 'openai/text-embedding-3-small',
      embeddingTextHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      embeddedAt: now,
    })
  })

  it('si el embedding falla, escribe igual el style y los textos', async () => {
    const write = vi.fn(async () => {})
    const result = await applySearchTextChanges([planStyleChange(row(), byIcon)!], { write, embed: async () => { throw new Error('gateway') } })
    expect(result).toEqual({ written: 1, embedError: 'No se pudieron generar los embeddings: gateway' })
    expect(write).toHaveBeenCalledWith('uuid-1', expect.not.objectContaining({ embedding: expect.anything() }))
    expect(write).toHaveBeenCalledWith('uuid-1', expect.objectContaining({ style: 'casual' }))
  })
})

describe('planMomentsChange', () => {
  const matute = row({ name: 'Matute', categories: ['brewery', 'bar'], tags: ['picada', 'craft_beer', 'date'] })

  it('reemplaza sólo los momentos y regenera los textos', () => {
    const change = planMomentsChange(matute, { tags: ['picada', 'craft_beer', 'date', 'groups'] })!
    expect(change).toMatchObject({ before: ['date'], after: ['date', 'groups'], added: ['groups'], removed: [], skipped: false })
    expect(change.values).toEqual({ tags: ['picada', 'craft_beer', 'date', 'groups'] })
    expect(change.embeddingText).toContain('Grupos')
    expect(change.keywordText).toContain('con amigos')
  })

  it('informa los que el replay saca; sin cambios de momentos, null aunque cambien otros tags', () => {
    expect(planMomentsChange(matute, { tags: ['picada'] })).toMatchObject({ added: [], removed: ['date'], values: { tags: ['picada', 'craft_beer'] } })
    expect(planMomentsChange(matute, { tags: ['pizza', 'date'] })).toBeNull()
  })

  it('un replay no vuelve a poner un tag sacado a mano, pero sí suma uno nuevo', () => {
    // date se sacó a mano; el replay lo vuelve a deducir y además deduce groups.
    const edited = row({ ...matute, tags: ['picada', 'craft_beer'], manualOverrides: { tags: { add: [], remove: ['date'] } } })
    const change = planMomentsChange(edited, { tags: ['picada', 'craft_beer', 'date', 'groups'] })!
    expect(change).toMatchObject({ before: [], after: ['groups'], added: ['groups'], removed: [], skipped: false })
    expect(change.values).toEqual({ tags: ['picada', 'craft_beer', 'groups'] })
    expect(change.keywordText).not.toContain('Cita')
  })

  it('un tag agregado a mano queda aunque el replay no lo deduzca; si sólo cambiaría eso, null', () => {
    const edited = row({ ...matute, manualOverrides: { tags: { add: ['date'], remove: [] } } })
    expect(planMomentsChange(edited, { tags: ['picada', 'craft_beer'] })).toBeNull()
    expect(planMomentsChange(edited, { tags: ['picada', 'craft_beer', 'groups'] })!.values).toEqual({ tags: ['picada', 'craft_beer', 'groups', 'date'] })
  })

  it('al aplicar escribe los tags, no el style', async () => {
    const write = vi.fn(async () => {})
    await applySearchTextChanges([planMomentsChange(matute, { tags: ['picada', 'groups'] })!], { write, embed: async (texts) => texts.map(() => [1]) })
    expect(write).toHaveBeenCalledWith('uuid-1', expect.objectContaining({ tags: ['picada', 'craft_beer', 'groups'], embedding: [1] }))
    expect(write).toHaveBeenCalledWith('uuid-1', expect.not.objectContaining({ style: expect.anything() }))
  })
})

describe('planTagsChange', () => {
  const brickel = row({ name: 'Brickel Irish Pub', tags: ['burgers', 'live_music', 'groups'] })
  const dancing = (id: string): id is 'dancing' => id === 'dancing'

  it('reemplaza sólo los tags pedidos; los demás quedan como están guardados', () => {
    const change = planTagsChange(brickel, { tags: ['burgers', 'dancing', 'date'] }, dancing)!
    expect(change).toMatchObject({ before: [], after: ['dancing'], added: ['dancing'], removed: [] })
    expect(change.values).toEqual({ tags: ['burgers', 'live_music', 'groups', 'dancing'] })
    expect(change.keywordText).toContain('Para bailar')
  })

  it('sin cambios en los tags pedidos, null', () => {
    expect(planTagsChange(brickel, { tags: ['burgers', 'date'] }, dancing)).toBeNull()
  })
})
