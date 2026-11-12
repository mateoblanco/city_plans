// Intenciones y sub-filtros que ordenan por afinidad (dessertFit, subFit), los motivos del sub-filtro activo, las frases
// del diccionario que no son lo que dice su sinónimo y los avisos que no nombran una intención que no se eligió.
import { describe, expect, it } from 'vitest'
import { INTENT_IDS, INTENTS } from '@shared/intents.ts'
import { SEARCH_CONFIG } from '../config'
import { applyDictionary, interpretWithDictionary } from '../dictionary'
import { boostsFor, dessertFitOf, SUB_SIGNALS, type FuseContext } from '../fuse'
import { emptyInterpretation } from '../interpretation'
import { runSearch } from '../search'
import { fakeCache, fakeStore, row } from './fixtures'

// Lunes 12/10/2026 13:00 en Montevideo.
const now = new Date('2026-10-12T16:00:00Z')
const context = (overrides: Partial<FuseContext> = {}): FuseContext => ({
  pinnedId: null, dishes: [], categories: [], requestedTags: [], preferTags: [], moments: [], cuisines: [], preferStyle: null, price: [], openAt: null, wantsBest: false, intent: null, section: null, diet: [], preferDiet: [], ...overrides,
})
const { dessertFit, dessertFitPartial, subFit } = SEARCH_CONFIG.boosts
const noLlm = () => fakeCache(new Error('no debería llamar al modelo')).cache

describe('dessertFit', () => {
  const heladeria = row({ id: 'heladeria', categories: ['ice_cream_shop'], tags: ['ice_cream'], iconCategory: 'ice_cream' })
  const pasteleria = row({ id: 'pasteleria', categories: ['cafe', 'bakery'], tags: ['pastries', 'desserts'], iconCategory: 'cake' })
  const cafe = row({ id: 'cafe', categories: ['cafe'], tags: ['pastries', 'desserts', 'specialty_coffee'], iconCategory: 'coffee' })
  const panaderia = row({ id: 'panaderia', categories: ['bakery'], iconCategory: 'croissant' })
  const restaurante = row({ id: 'restaurante', categories: ['restaurant'], tags: ['desserts', 'pastries'], iconCategory: 'pasta' })
  const bar = row({ id: 'bar', categories: ['bar'], tags: ['desserts'], iconCategory: 'beer_pub' })

  it('entero para el lugar de postres, parcial para el café con pastelería, nada para el tag desserts suelto', () => {
    expect(dessertFitOf(heladeria)).toBe(dessertFit)
    expect(dessertFitOf(pasteleria)).toBe(dessertFit)
    expect(dessertFitOf(row({ id: 'h', categories: ['ice_cream_shop'] }))).toBe(dessertFit)
    expect(dessertFitOf(cafe)).toBeCloseTo(dessertFit * dessertFitPartial)
    expect(dessertFitOf(panaderia)).toBeCloseTo(dessertFit * dessertFitPartial)
    expect(dessertFitOf(restaurante)).toBe(0)
    expect(dessertFitOf(bar)).toBe(0)
  })

  it('sólo con la intención Postres', () => {
    expect(boostsFor(heladeria, context({ intent: 'desserts' }), null).dessertFit).toBe(dessertFit)
    expect(boostsFor(heladeria, context({ intent: 'cafes' }), null).dessertFit).toBeUndefined()
    expect(boostsFor(heladeria, context(), null).dessertFit).toBeUndefined()
  })

  it('Postres sin texto: los de postres primero, después los cafés con pastelería, aunque tengan menos calidad', async () => {
    const places = [
      row({ ...restaurante, prominence: 1, featured: true }),
      row({ ...bar, prominence: 0.95 }),
      row({ ...cafe, prominence: 0.9 }),
      row({ ...heladeria, prominence: 0.1 }),
      row({ ...pasteleria, prominence: 0.2 }),
    ]
    const response = await runSearch('', { store: fakeStore(places).store, cache: noLlm() }, { now, intent: 'desserts' })
    expect(response.results.map((result) => result.id)).toEqual(['pasteleria', 'heladeria', 'cafe', 'restaurante', 'bar'])
  })
})

describe('subFit y la señal de cada sub-filtro', () => {
  it('cada sub-filtro de cada intención tiene su señal (o null a propósito)', () => {
    for (const intent of INTENT_IDS) expect(Object.keys(SUB_SIGNALS[intent]).sort()).toEqual(Object.keys(INTENTS[intent].subs).sort())
  })

  it('Tragos: signature_cocktails o el ícono de coctelería suman; classic_cocktails no', () => {
    const bars = context({ intent: 'bars', subs: ['cocktails'] })
    expect(boostsFor(row({ id: 'autor', categories: ['bar'], tags: ['signature_cocktails'] }), bars, null).subFit).toBe(subFit)
    expect(boostsFor(row({ id: 'icono', categories: ['bar'], tags: ['classic_cocktails'], iconCategory: 'cocktails' }), bars, null).subFit).toBe(subFit)
    expect(boostsFor(row({ id: 'clasico', categories: ['bar'], tags: ['classic_cocktails'] }), bars, null).subFit).toBeUndefined()
    // Sin el sub-filtro activo, nada.
    expect(boostsFor(row({ id: 'autor', categories: ['bar'], tags: ['signature_cocktails'] }), context({ intent: 'bars' }), null).subFit).toBeUndefined()
  })

  it('un sub-filtro por señal: dos sub-filtros con señal suman dos veces', () => {
    const value = context({ intent: 'bars', subs: ['cocktails', 'live_music'] })
    const both = row({ id: 'both', categories: ['bar'], tags: ['signature_cocktails', 'live_music'], signature: ['live_music'] })
    expect(boostsFor(both, value, null).subFit).toBeCloseTo(2 * subFit)
  })

  it('almuerzo y cena no tienen señal más fina que su tag', () => {
    expect(boostsFor(row({ id: 'r', categories: ['restaurant'], tags: ['lunch', 'menu_of_the_day'] }), context({ intent: 'eat', subs: ['lunch'] }), null).subFit).toBeUndefined()
  })

  it('Tragos sin texto: los de autor primero y el motivo es el tag del sub-filtro, no la cerveza', async () => {
    const places = [
      row({ id: 'cerveceria', categories: ['bar', 'brewery'], tags: ['craft_beer', 'classic_cocktails'], signature: ['craft_beer'], iconCategory: 'beer', prominence: 1 }),
      row({ id: 'autor', categories: ['bar'], tags: ['signature_cocktails', 'classic_cocktails'], iconCategory: 'classic_bar', prominence: 0.2 }),
    ]
    const response = await runSearch('', { store: fakeStore(places).store, cache: noLlm() }, { now, intent: 'bars', sub: 'cocktails' })
    expect(response.results.map((result) => result.id)).toEqual(['autor', 'cerveceria'])
    expect(response.results[0].reasons[0]).toBe('Tragos de autor')
    expect(response.results[1].reasons[0]).toBe('Coctelería')
  })
})

describe('frases del diccionario', () => {
  it('"X al pan": el plato y sándwiches como preferencia', () => {
    const value = interpretWithDictionary('milanesa al pan')
    expect(value?.dishes.map((dish) => dish.name)).toEqual(['milanesa'])
    expect(value?.prefer.tags).toContain('sandwiches')
    expect(value?.unrecognized).toEqual([])
    // Una comida que el catálogo no tiene la lee el modelo; "al pan" igual suma sándwiches y deja de estar sin reconocer.
    expect(interpretWithDictionary('bondiola al pan')).toBeNull()
    const llm = { ...emptyInterpretation(), dishes: [{ name: 'bondiola', relatedTags: [], relatedCategories: [] }], unrecognized: ['al pan'] }
    const merged = applyDictionary(llm, 'bondiola al pan')
    expect(merged.prefer.tags).toContain('sandwiches')
    expect(merged.unrecognized).toEqual([])
  })

  it('"para compartir" es preferencia por picadas y tapas, no un plato', () => {
    const value = interpretWithDictionary('picada para compartir')
    expect(value?.dishes.map((dish) => dish.name)).toEqual(['picada'])
    expect(value?.prefer.tags).toEqual(expect.arrayContaining(['picada', 'tapas']))
    const llm = { ...emptyInterpretation(), dishes: [{ name: 'para compartir', relatedTags: ['picada'], relatedCategories: [] }] }
    expect(applyDictionary(llm, 'algo rico para compartir').dishes).toEqual([])
  })

  it('"vinos por copa" es el tag wine (Vinos con Bares), no la categoría vinoteca obligatoria', () => {
    for (const query of ['vinos por copa', 'vino por copa', 'wine by the glass']) {
      const value = interpretWithDictionary(query)
      expect(value?.must.categories, query).toEqual([])
      expect(value?.must.tags, query).toEqual(['wine'])
    }
    const llm = { ...emptyInterpretation(), must: { ...emptyInterpretation().must, categories: ['wine_bar'] } }
    const merged = applyDictionary(llm, 'donde tomar vinos por copa')
    expect(merged.must.categories).toEqual([])
    expect(merged.must.tags).toContain('wine')
  })

  it('"vinos por copa" trae los bares con vino, no sólo las vinotecas', async () => {
    const places = [
      row({ id: 'vinoteca', categories: ['wine_bar'], tags: ['wine'] }),
      row({ id: 'bar-con-vino', categories: ['bar'], tags: ['wine'] }),
      row({ id: 'cerveceria', categories: ['brewery'], tags: ['craft_beer'] }),
    ]
    const response = await runSearch('vinos por copa', { store: fakeStore(places).store, cache: noLlm() }, { now })
    expect(response.results.map((result) => result.id).sort()).toEqual(['bar-con-vino', 'vinoteca'])
    expect(response.bar.subs.find((sub) => sub.id === 'wine')?.active).toBe(true)
  })
})

describe('avisos de relajación', () => {
  // Restaurantes en Pocitos, ninguno con almuerzo.
  const places = [
    row({ id: 'a', categories: ['restaurant'], tags: ['dinner'], neighborhoodId: 'POCITOS' }),
    row({ id: 'b', categories: ['restaurant'], tags: ['dinner'], neighborhoodId: 'POCITOS' }),
  ]

  it('con la intención deducida de un tag ("almuerzo" → Comer), el aviso no la nombra', async () => {
    const response = await runSearch('almuerzo en pocitos', { store: fakeStore(places).store, cache: noLlm() }, { now })
    expect(response.relaxed.map((step) => step.message)).toEqual(['No encontramos lugares para almorzar; estos son los más parecidos.'])
  })

  it('con la intención elegida en la barra o dicha con un verbo, sí', async () => {
    const chosen = await runSearch('almuerzo en pocitos', { store: fakeStore(places).store, cache: noLlm() }, { now, intent: 'eat' })
    expect(chosen.relaxed.map((step) => step.message)).toEqual(['No encontramos lugares para comer para almorzar; estos son los más parecidos.'])
    const verb = await runSearch('', { store: fakeStore(places).store, cache: noLlm() }, { now, intent: 'eat', sub: 'lunch' })
    expect(verb.relaxed.map((step) => step.message)).toEqual(['No encontramos lugares para comer para almorzar; estos son los más parecidos.'])
  })
})
