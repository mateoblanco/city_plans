import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { withSubcuisines } from '@shared/tags.ts'
import { SEARCH_CONFIG } from '../config'
import { filterConditions, type CandidateFilters } from '../candidates'
import { isMainCuisine, requestedCuisines } from '../cuisines'
import { applyDictionary, interpretWithDictionary } from '../dictionary'
import { boostsFor, buildRankings, fuse, matchLevelOf, type FuseContext } from '../fuse'
import { normalizeQuery } from '../normalize'
import { keywordsFor, nameWordsFor, runSearch } from '../search'
import { emptyInterpretation, type Interpretation } from '../interpretation'
import { fakeCache, fakeStore, llmOutput, row } from './fixtures'

const now = new Date('2026-10-12T16:00:00Z')
const dictionary = (query: string) => interpretWithDictionary(normalizeQuery(query))
const context = (overrides: Partial<FuseContext> = {}): FuseContext => ({
  pinnedId: null, dishes: [], categories: [], requestedTags: [], preferTags: [], moments: [], cuisines: [], preferStyle: null, price: [], openAt: null, wantsBest: false, intent: null, section: null, diet: [], preferDiet: [], ...overrides,
})
const filters = (overrides: Partial<CandidateFilters> = {}): CandidateFilters => ({
  categories: [], tags: [], diet: [], neighborhoods: [], venues: [], price: [], openAt: null, excludeCategories: [], excludeTags: [], excludeIcons: [], dishes: [], dishMode: 'dish', near: null, groups: [], ...overrides,
})
const toSql = (value: CandidateFilters) => {
  const dialect = new PgDialect()
  return filterConditions(value).map((condition) => dialect.sqlToQuery(condition))
}

describe('cocinas paraguas', () => {
  it('asian incluye japonesa, china, coreana y nikkei; latin_american, las latinas; las demás, sólo ellas', () => {
    expect(withSubcuisines('asian')).toEqual(['asian', 'japanese', 'chinese', 'korean', 'nikkei'])
    expect(withSubcuisines('latin_american')).toEqual(['latin_american', 'mexican', 'venezuelan', 'peruvian', 'brazilian'])
    expect(withSubcuisines('asian')).not.toContain('indian')
    expect(withSubcuisines('asian')).not.toContain('middle_eastern')
    expect(withSubcuisines('peruvian')).toEqual(['peruvian'])
    expect(withSubcuisines('terrace')).toEqual(['terrace'])
  })

  it('el diccionario resuelve "asiático", "comida oriental" y "comida latinoamericana" sin modelo; "algo asiático" sigue yendo al modelo', () => {
    expect(dictionary('asiático')?.must.tags).toEqual(['asian'])
    expect(dictionary('comida oriental')?.must.tags).toEqual(['asian'])
    expect(dictionary('asiática')?.must.tags).toEqual(['asian'])
    expect(dictionary('comida latinoamericana')?.must.tags).toEqual(['latin_american'])
    expect(dictionary('algo asiático')).toBeNull()
  })

  it('SQL: la madre es "cualquiera de" la familia; los demás tags, todos; los exclude se expanden', () => {
    const [plain, family] = toSql(filters({ tags: ['terrace', 'asian'] }))
    expect(plain.sql).toBe('tags @> $1::text[]')
    expect(plain.params).toEqual([['terrace']])
    expect(family.sql).toBe('tags && $1::text[]')
    expect(family.params).toEqual([withSubcuisines('asian')])
    expect(toSql(filters({ tags: ['peruvian'] }))[0].sql).toBe('tags @> $1::text[]')
    const [exclude] = toSql(filters({ excludeTags: ['asian'] }))
    expect(exclude.params).toEqual([withSubcuisines('asian')])
  })

  it('"algo asiático" trae a los japoneses y chinos aunque no tengan el tag asian; no a la india', async () => {
    const places = [
      row({ id: 'sushi', categories: ['restaurant'], tags: ['japanese', 'sushi'], signature: ['sushi', 'japanese'], iconCategory: 'sushi' }),
      row({ id: 'wok', categories: ['restaurant'], tags: ['chinese'], signature: ['chinese'], iconCategory: 'wok' }),
      row({ id: 'thai', categories: ['restaurant'], tags: ['asian'], signature: ['asian'] }),
      row({ id: 'india', categories: ['restaurant'], tags: ['indian'], signature: ['indian'], iconCategory: 'curry' }),
    ]
    const { store, calls } = fakeStore(places)
    const cache = fakeCache(llmOutput({ must: { ...llmOutput().must, tags: ['asian'] } })).cache
    const response = await runSearch('algo asiático', { store, cache }, { now, debug: true })
    expect(response.debug?.source).toBe('llm')
    // "algo" no va como keyword ni al nombre.
    expect(response.debug?.keywords).toEqual(['asiatico'])
    expect(calls[0].scores.name).toBe('asiatico')
    expect(response.results.map((result) => result.id).sort()).toEqual(['sushi', 'thai', 'wok'])
    expect(response.results.every((result) => result.matchLevel === 'has')).toBe(true)
  })
})

describe('cocina principal o secundaria', () => {
  const sabor = row({ id: 'sabor', tags: ['peruvian'], signature: ['peruvian', 'seafood'], iconCategory: 'fish' })
  const pescado = row({ id: 'pescado', tags: ['peruvian'], signature: ['seafood'], iconCategory: 'fish' })
  const kantina = row({ id: 'kantina', tags: ['peruvian', 'tapas'], signature: ['tapas'], iconCategory: 'tapas' })
  const nikkei = row({ id: 'nikkei', tags: ['peruvian', 'nikkei'], signature: ['sushi', 'nikkei'], iconCategory: 'sushi' })

  it('principal por signature o por ícono; con el tag solo, secundaria', () => {
    expect(isMainCuisine(sabor, 'peruvian')).toBe(true)
    expect(isMainCuisine(pescado, 'peruvian')).toBe(true)
    expect(isMainCuisine(kantina, 'peruvian')).toBe(false)
    expect(isMainCuisine(nikkei, 'peruvian')).toBe(false)
    // Para la madre cuenta la cocina de una hija.
    expect(isMainCuisine(nikkei, 'asian')).toBe(true)
    expect(isMainCuisine(row({ id: 'sushi', iconCategory: 'sushi' }), 'asian')).toBe(true)
  })

  it('con una cocina pedida, la secundaria es maybe y va debajo; sin cocina, todo has', () => {
    expect(matchLevelOf(kantina, [], [], [], ['peruvian'])).toBe('maybe')
    expect(matchLevelOf(sabor, [], [], [], ['peruvian'])).toBe('has')
    expect(matchLevelOf(kantina, [])).toBe('has')
    const rows = [row({ ...kantina, semantic: 0.9 }), row({ ...sabor, semantic: 0.5 })]
    const fused = fuse(rows, buildRankings(rows), context({ cuisines: ['peruvian'], requestedTags: ['peruvian'] }))
    expect(fused.map((item) => [item.row.id, item.matchLevel])).toEqual([['sabor', 'has'], ['kantina', 'maybe']])
  })

  it('las cocinas pedidas salen de los tags; las que no son cocina no cuentan', () => {
    expect(requestedCuisines(['peruvian', 'terrace', 'peruvian', 'wine'])).toEqual(['peruvian'])
  })
})

describe('palabras vacías', () => {
  const edits = { removed: false, removedWords: new Set<string>(), shortcut: true }
  it('"comida", "lugar", "sitio"… no van al nombre ni a las keywords', () => {
    expect(nameWordsFor('comida peruana', new Set())).toEqual(['peruana'])
    expect(nameWordsFor('un lugar o sitio con comida', new Set())).toEqual([])
    expect(nameWordsFor('something spicy food', new Set())).toEqual(['spicy'])
    expect(keywordsFor('comida peruana', emptyInterpretation(), edits)).toEqual(['peruana'])
  })

  it('las negaciones no van al nombre: "sin carne" no es Sin Berretines; el nombre entero se sigue encontrando', () => {
    expect(nameWordsFor('algo sin carne', new Set())).toEqual(['carne'])
    expect(nameWordsFor('cualquier cosa menos pizza ni sushi', new Set())).toEqual(['cualquier', 'cosa', 'pizza', 'sushi'])
    expect(nameWordsFor('without meat', new Set())).toEqual(['meat'])
    expect(nameWordsFor('sin berretines', new Set())).toEqual(['berretines'])
  })

  it('las negaciones tampoco van como keyword', () => {
    expect(keywordsFor('algo sin carne', emptyInterpretation(), edits)).toEqual(['carne'])
    expect(keywordsFor('pizza excepto muzzarella', emptyInterpretation(), edits)).toEqual(['pizza', 'muzzarella'])
    expect(keywordsFor('without meat', emptyInterpretation(), edits)).toEqual(['meat'])
  })
})

describe('barFit según la bebida pedida', () => {
  const { barFit } = SEARCH_CONFIG.boosts
  const vinoteca = row({ id: 'vinoteca', categories: ['wine_bar', 'bar'], iconCategory: 'tapas' })
  const wineIcon = row({ id: 'wine', categories: ['bar'], iconCategory: 'wine' })
  const cerveceria = row({ id: 'cerveceria', categories: ['brewery', 'bar'], iconCategory: 'beer_pub' })
  const clasico = row({ id: 'clasico', categories: ['bar'], iconCategory: 'classic_bar' })
  const sushi = row({ id: 'sushi', categories: ['bar', 'restaurant'], iconCategory: 'sushi' })

  it('vino: entero para el ícono o la categoría del vino, la mitad para los otros bares, nada para el resto', () => {
    const wine = context({ requestedTags: ['wine'], intent: 'bars' })
    expect(boostsFor(wineIcon, wine, null).barFit).toBe(barFit)
    expect(boostsFor(vinoteca, wine, null).barFit).toBe(barFit)
    expect(boostsFor(cerveceria, wine, null).barFit).toBe(barFit / 2)
    expect(boostsFor(sushi, wine, null).barFit).toBeUndefined()
  })

  it('cerveza → cervecerías; vermú y whisky → bar clásico; también sin la intención Bares', () => {
    expect(boostsFor(cerveceria, context({ requestedTags: ['draft_beer'] }), null).barFit).toBe(barFit)
    expect(boostsFor(wineIcon, context({ requestedTags: ['draft_beer'] }), null).barFit).toBe(barFit / 2)
    expect(boostsFor(clasico, context({ requestedTags: ['vermouth'] }), null).barFit).toBe(barFit)
    expect(boostsFor(cerveceria, context({ requestedTags: ['whisky'] }), null).barFit).toBe(barFit / 2)
  })

  it('sin bebida pedida (o una sin bar propio), como siempre: entero para cualquier bar con Bares', () => {
    expect(boostsFor(cerveceria, context({ intent: 'bars' }), null).barFit).toBe(barFit)
    expect(boostsFor(cerveceria, context({ intent: 'bars', requestedTags: ['tea'] }), null).barFit).toBe(barFit)
    expect(boostsFor(cerveceria, context({ requestedTags: ['terrace'] }), null).barFit).toBeUndefined()
  })
})

describe('cocinas del texto sobre lo del modelo', () => {
  const model = (change: (value: Interpretation) => void = () => {}) => {
    const value = emptyInterpretation()
    change(value)
    return value
  }

  it('el modelo no puso la cocina: se suma como requisito', () => {
    expect(applyDictionary(model(), 'algo asiatico').must.tags).toEqual(['asian'])
    expect(applyDictionary(model(), 'algo de comida peruana lindo').must.tags).toEqual(['peruvian'])
  })

  it('si el modelo ya la puso en algún lado (requisito, preferencia, exclude o plato), no se toca', () => {
    expect(applyDictionary(model((value) => value.prefer.tags.push('asian')), 'algo asiatico').must.tags).toEqual([])
    expect(applyDictionary(model((value) => value.exclude.tags.push('asian')), 'algo asiatico').must.tags).toEqual([])
    expect(applyDictionary(model((value) => value.dishes.push({ name: 'ceviche', relatedTags: ['peruvian'], relatedCategories: [] })), 'ceviche peruano rico').must.tags).toEqual([])
  })

  it('lo negado no se suma', () => {
    expect(applyDictionary(model(), 'algo que no sea asiatico').must.tags).toEqual([])
    expect(applyDictionary(model(), 'cualquier cosa menos asiatico').must.tags).toEqual([])
  })
})

describe('sin carne', () => {
  const { preferDiet } = SEARCH_CONFIG.boosts

  it('por el diccionario: exclude de la carne, sin dieta', () => {
    const value = dictionary('barato sin carne')
    expect(value?.exclude.tags).toEqual(['grilled_meat'])
    expect(value?.must.diet).toEqual({})
    expect(value?.must.price).toEqual(['low'])
    // "vegetariano" sigue filtrando.
    expect(dictionary('vegetariano')?.must.diet).toEqual({ vegetarian: true })
  })

  it('por el modelo: si lo hizo dieta vegetariana, pasa a exclude; si el texto dice vegetariano, la dieta queda', () => {
    const vegetarian = emptyInterpretation()
    vegetarian.must.diet.vegetarian = true
    const fixed = applyDictionary(vegetarian, 'algo sin carne')
    expect(fixed.must.diet).toEqual({})
    expect(fixed.exclude.tags).toEqual(['grilled_meat'])
    expect(applyDictionary(vegetarian, 'algo vegetariano sin carne').must.diet).toEqual({ vegetarian: true })
  })

  it('SQL: también saca los íconos de carne; un lugar sin ícono no', () => {
    const [, icons] = toSql(filters({ excludeTags: ['grilled_meat'], excludeIcons: ['grill', 'meat'] }))
    expect(icons.sql).toBe('(icon_category is null or not (icon_category = any($1::text[])))')
    expect(icons.params).toEqual([['grill', 'meat']])
  })

  it('en la búsqueda: sin parrillas ni carnes (por tag o ícono), y los vegetarianos arriba sin filtrar', async () => {
    const places = [
      row({ id: 'parrilla', categories: ['grill'], iconCategory: 'grill', semantic: 0.9 }),
      row({ id: 'ahumados', categories: ['restaurant'], iconCategory: 'meat', semantic: 0.9 }),
      row({ id: 'asado', categories: ['restaurant'], tags: ['grilled_meat'], semantic: 0.9 }),
      row({ id: 'pasta', categories: ['restaurant'], iconCategory: 'pasta', semantic: 0.85, price: 'low' }),
      row({ id: 'opciones', categories: ['restaurant'], iconCategory: 'pasta', semantic: 0.84, price: 'low', diet: { vegan: 'unknown', vegetarian: 'has_options', glutenFree: 'unknown' } }),
      row({ id: 'veggie', categories: ['restaurant'], iconCategory: 'salad', semantic: 0.83, price: 'low', diet: { vegan: 'unknown', vegetarian: 'fully', glutenFree: 'unknown' } }),
    ]
    const response = await runSearch('barato sin carne', { store: fakeStore(places).store, cache: fakeCache().cache }, { now, debug: true })
    expect(response.debug?.source).toBe('shortcut')
    expect(response.results.map((result) => result.id)).toEqual(['veggie', 'opciones', 'pasta'])
    const boosts = new Map(response.debug!.results.map((result) => [result.id, result.boosts.preferDiet]))
    expect(boosts.get('veggie')).toBe(preferDiet)
    expect(boosts.get('opciones')).toBe(preferDiet / 2)
    expect(boosts.get('pasta')).toBeUndefined()
  })

  it('con vegetariano exigido, no suma también como preferencia', () => {
    const veggie = row({ id: 'veggie', diet: { vegan: 'unknown', vegetarian: 'fully', glutenFree: 'unknown' } })
    expect(boostsFor(veggie, context({ diet: ['vegetarian'] }), null).preferDiet).toBeUndefined()
  })
})
