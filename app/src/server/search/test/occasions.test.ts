import { describe, expect, it } from 'vitest'
import { findDef, OCCASION_TAGS } from '@shared/tags.ts'
import { SEARCH_CONFIG } from '../config'
import { interpretWithDictionary } from '../dictionary'
import { dishTarget } from '../dishes'
import { boostsFor, type FuseContext } from '../fuse'
import { applyRemove, validateInterpretation } from '../interpretation'
import { normalizeQuery } from '../normalize'
import { runSearch } from '../search'
import { removeChipHref } from '../../../components/pages/SearchPage/utils/search-href'
import { everyDay, fakeCache, fakeStore, llmOutput, row } from './fixtures'

// Lunes 12/10/2026 13:00 en Montevideo.
const now = new Date('2026-10-12T16:00:00Z')
const dictionary = (query: string) => interpretWithDictionary(normalizeQuery(query))
const context = (overrides: Partial<FuseContext> = {}): FuseContext => ({
  pinnedId: null, dishes: [], categories: [], requestedTags: [], preferTags: [], preferStyle: null, price: [], openAt: null, wantsBest: false, wantsDancing: false, ...overrides,
})

describe('momentos y style en la interpretación', () => {
  it('el atajo los toma como preferencia', () => {
    expect(dictionary('bar con amigos')?.prefer.tags).toEqual(['groups'])
    expect(dictionary('algo rápido')?.prefer.tags).toEqual(['quick'])
    expect(dictionary('para una cita')?.prefer.tags).toEqual(['date'])
    expect(dictionary('festejar un cumpleaños')?.prefer.tags).toEqual(['celebration'])
    expect(dictionary('con los chicos')?.prefer.tags).toEqual(['kids_friendly'])
  })

  it('"bar de barrio" es bar + casual, sin perder "de barrio" en las palabras vacías', () => {
    const result = dictionary('bar de barrio')
    expect(result?.must.categories).toEqual(['bar'])
    expect(result?.prefer.style).toBe('casual')
    expect(dictionary('algo especial')).toBeNull()
    expect(dictionary('restaurante de autor')?.prefer.style).toBe('cuidado')
  })

  it('la cita trae el estilo según la consulta; "cita" sola es sólo date', () => {
    const preference = (query: string) => {
      const result = dictionary(query)
      return result && { tags: result.prefer.tags, style: result.prefer.style, must: result.must.tags }
    }
    for (const query of ['primera cita', 'algo tranqui para una cita', 'cita descontracturada']) {
      expect(preference(query), query).toEqual({ tags: ['date'], style: 'casual', must: [] })
    }
    for (const query of ['aniversario', 'cita especial']) {
      expect(preference(query), query).toEqual({ tags: ['date'], style: 'cuidado', must: [] })
    }
    // dinner queda igual que con "cena" sola.
    expect(preference('cena romántica')).toEqual({ tags: ['date'], style: 'cuidado', must: dictionary('cena')!.must.tags })
    expect(preference('cena romántica')?.must).toEqual(['dinner'])
    expect(preference('cita')).toEqual({ tags: ['date'], style: null, must: [] })
    expect(preference('bar para una primera cita en Pocitos')).toMatchObject({ tags: ['date'], style: 'casual' })
  })

  it('"aniversario" no es celebration: puede ser el del propio local', () => {
    expect(findDef('celebration')?.synonyms.es).not.toContain('aniversario')
    expect(findDef('celebration')?.synonyms.en).not.toContain('anniversary')
    expect(dictionary('aniversario')?.prefer.tags).toEqual(['date'])
    const english = dictionary('anniversary')
    expect({ tags: english?.prefer.tags, style: english?.prefer.style, language: english?.language }).toEqual({ tags: ['date'], style: 'cuidado', language: 'en' })
  })

  it('"elegante" también pide un lugar cuidado', () => {
    const result = dictionary('restaurante elegante')
    expect(result?.prefer.tags).toEqual(['elegant'])
    expect(result?.prefer.style).toBe('cuidado')
  })

  it('un momento que el modelo exigió pasa a preferencia y queda informado', () => {
    const { interpretation, toPrefer } = validateInterpretation(llmOutput({
      must: { ...llmOutput().must, categories: ['bar'], tags: ['groups', 'terrace'] },
      prefer: { categories: [], tags: ['casual'] },
    }))
    expect(interpretation.must.tags).toEqual(['terrace'])
    expect(interpretation.prefer.tags).toEqual(['groups'])
    expect(interpretation.prefer.style).toBe('casual')
    expect(toPrefer).toEqual(['tag:groups'])
  })

  it('un style en must también es preferencia; en exclude se descarta', () => {
    const { interpretation, discarded } = validateInterpretation(llmOutput({
      must: { ...llmOutput().must, tags: ['cuidado'] },
      exclude: { categories: [], tags: ['casual'] },
    }))
    expect(interpretation.prefer.style).toBe('cuidado')
    expect(discarded).toEqual(['casual'])
  })

  it('quitar el chip del style lo saca', () => {
    const value = dictionary('bar de barrio')!
    expect(applyRemove(value, [{ kind: 'prefer', id: 'casual' }]).prefer.style).toBeNull()
  })

  it('todos los momentos son de goodFor y el diccionario los resuelve', () => {
    for (const id of OCCASION_TAGS) expect(dictionary(id.replace('_', ' '))?.prefer.tags ?? [id]).toContain(id)
  })
})

describe('precio en el atajo', () => {
  it('barato, económico, caro y de lujo', () => {
    expect(dictionary('bar barato')?.must.price).toEqual(['low'])
    expect(dictionary('restaurante económico')?.must.price).toEqual(['low'])
    expect(dictionary('restaurante caro')?.must.price).toEqual(['high', 'very_high'])
    expect(dictionary('restaurante de lujo')?.must.price).toEqual(['very_high'])
  })
})

describe('empujones', () => {
  it('el style pedido suma como una preferencia', () => {
    expect(boostsFor(row({ id: 'a', style: 'casual' }), context({ preferStyle: 'casual' }), null).preferStyle).toBe(SEARCH_CONFIG.boosts.preferStyle)
    expect(boostsFor(row({ id: 'a', style: 'cuidado' }), context({ preferStyle: 'casual' }), null).preferStyle).toBeUndefined()
  })

  it('con precio pedido, el confirmado suma y el desconocido no', () => {
    expect(boostsFor(row({ id: 'a', price: 'low' }), context({ price: ['low'] }), null).priceMatch).toBe(SEARCH_CONFIG.boosts.priceMatch)
    expect(boostsFor(row({ id: 'a', price: 'unknown' }), context({ price: ['low'] }), null).priceMatch).toBeUndefined()
    expect(boostsFor(row({ id: 'a', price: 'low' }), context(), null).priceMatch).toBeUndefined()
  })

  it('con "lo mejor", signature pesa más que un primer puesto y más del doble que un match común', () => {
    const place = row({ id: 'a', tags: ['chivito'], signature: ['chivito'] })
    const common = boostsFor(place, context({ requestedTags: ['chivito'] }), null).signature!
    const best = boostsFor(place, context({ requestedTags: ['chivito'], wantsBest: true }), null).signature!
    expect(best).toBeGreaterThan(2 * common)
    expect(best).toBeGreaterThan(1 / (SEARCH_CONFIG.rrf.k + 1))
  })
})

describe('búsqueda con momentos y style', () => {
  const places = [
    row({ id: 'bar-barrio', categories: ['bar'], tags: ['groups'], style: 'casual', price: 'low' }),
    row({ id: 'bar-autor', categories: ['bar'], style: 'cuidado' }),
  ]

  it('se ven como extras removibles y ordenan sin filtrar', async () => {
    const response = await runSearch('bar de barrio con amigos', { store: fakeStore(places).store, cache: fakeCache().cache }, { now, debug: true })
    expect(response.debug?.source).toBe('shortcut')
    expect(response.results.map((result) => result.id)).toEqual(['bar-barrio', 'bar-autor'])
    const extras = response.bar.extras.map((chip) => `${chip.kind}:${chip.id}`)
    expect(extras).toEqual(expect.arrayContaining(['prefer:groups', 'prefer:casual']))
    expect(response.results[0].reasons).toEqual(['Descontracturado', 'Para ir con amigos'])

    const chip = response.bar.extras.find((item) => item.id === 'casual')!
    const remove = new URL(removeChipHref({ q: 'bar de barrio con amigos' }, chip), 'http://x').searchParams.get('remove')
    const removed = await runSearch('bar de barrio con amigos', { store: fakeStore(places).store, cache: fakeCache().cache }, { now, remove, debug: true })
    expect(removed.debug?.interpretation.prefer.style).toBeNull()
    expect(removed.bar.extras.map((item) => item.id)).not.toContain('casual')
  })

  it('"bar barato": el de precio confirmado va arriba del desconocido', async () => {
    const response = await runSearch('bar barato', { store: fakeStore([...places].reverse()).store, cache: fakeCache().cache }, { now, debug: true })
    expect(response.debug?.source).toBe('shortcut')
    expect(response.results.map((result) => result.id)).toEqual(['bar-barrio', 'bar-autor'])
    expect(response.interpreted.chips.map((chip) => `${chip.kind}:${chip.id}`)).toContain('price:low')
  })
})

describe('boliches abajo', () => {
  it('baja un boliche, un lugar "para bailar" y un dj sin comida', () => {
    for (const place of [
      row({ id: 'boliche', categories: ['bar', 'night_club'] }),
      row({ id: 'para-bailar', categories: ['bar'], tags: ['dancing', 'picada'] }),
      row({ id: 'dj-solo', categories: ['bar'], tags: ['dj', 'classic_cocktails'] }),
    ]) expect(boostsFor(place, context(), null).danceOnly, place.id).toBe(SEARCH_CONFIG.boosts.danceOnly)
  })

  it('un dj con comida no baja, y nada baja si la consulta pide bailar', () => {
    expect(boostsFor(row({ id: 'demode', categories: ['bar'], tags: ['dj', 'pizza'] }), context(), null).danceOnly).toBeUndefined()
    expect(boostsFor(row({ id: 'resto-dj', categories: ['restaurant'], tags: ['dj'] }), context(), null).danceOnly).toBeUndefined()
    expect(boostsFor(row({ id: 'boliche', categories: ['night_club'] }), context({ wantsDancing: true }), null).danceOnly).toBeUndefined()
  })

  it('"comer con amigos" deja al boliche detrás; "para bailar" no lo baja', async () => {
    const places = [
      row({ id: 'living', categories: ['bar'], tags: ['dancing', 'picada', 'groups'], semantic: 0.6 }),
      row({ id: 'bisiesto', categories: ['restaurant'], tags: ['picada', 'groups'], semantic: 0.5 }),
    ]
    const eat = await runSearch('comer con amigos', { store: fakeStore(places).store, cache: fakeCache().cache }, { now, debug: true })
    expect(eat.results.map((result) => result.id)).toEqual(['bisiesto', 'living'])
    const dance = await runSearch('bar para bailar', { store: fakeStore(places).store, cache: fakeCache().cache }, { now, debug: true })
    expect(dance.debug!.results.find((result) => result.id === 'living')!.boosts.danceOnly).toBeUndefined()
  })
})

describe('motivos', () => {
  it('lo más específico primero y no más de 3: signature de la intención, estilo, momento', async () => {
    const places = [
      row({ id: 'fundamento', categories: ['pizzeria', 'restaurant'], tags: ['pizza', 'craft_beer', 'groups'], signature: ['pizza', 'craft_beer'], style: 'casual' }),
      row({ id: 'intermedio', categories: ['restaurant'], tags: ['groups'], style: 'intermedio' }),
    ]
    const response = await runSearch('comer con amigos', { store: fakeStore(places).store, cache: fakeCache().cache }, { now })
    const reasons = Object.fromEntries(response.results.map((result) => [result.id, result.reasons]))
    // craft_beer no es de Comer; intermedio no suma motivo.
    expect(reasons.fundamento).toEqual(['Pizza', 'Descontracturado', 'Para ir con amigos'])
    expect(reasons.intermedio).toEqual(['Para ir con amigos'])
  })

  it('con Bares, la signature de bebida; nunca horario, barrio ni categoría', async () => {
    const places = [row({ id: 'matute', categories: ['brewery', 'bar'], tags: ['craft_beer', 'pizza', 'groups'], signature: ['craft_beer', 'pizza'], style: 'intermedio', hours: everyDay('12:00', '23:00') })]
    const response = await runSearch('tomar algo con amigos', { store: fakeStore(places).store, cache: fakeCache().cache }, { now })
    expect(response.results[0].reasons).toEqual(['Cerveza artesanal', 'Para ir con amigos'])
  })

  it('corta en 3 aunque haya más', async () => {
    const places = [row({ id: 'todo', featured: true, categories: ['restaurant'], tags: ['pizza', 'tapas', 'groups'], signature: ['pizza', 'tapas'], style: 'casual' })]
    const response = await runSearch('comer con amigos', { store: fakeStore(places).store, cache: fakeCache().cache }, { now })
    expect(response.results[0].reasons).toEqual(['Recomendado', 'Pizza', 'Tapas y platitos'])
  })
})

describe('ranking por nombre', () => {
  // "comer" se parece a "Comedor" (trigramas), pero la consulta la resolvió el diccionario: son términos, no un nombre.
  const places = [
    row({ id: 'comedor', name: 'Misión Comedor', categories: ['restaurant'], tags: ['groups'], nameScore: 0.33 }),
    row({ id: 'bisiesto', name: 'Bisiesto', categories: ['restaurant'], tags: ['groups'] }),
  ]

  it('con la consulta resuelta por el diccionario sólo cuenta una palabra entera del nombre', async () => {
    const response = await runSearch('comer con amigos', { store: fakeStore(places).store, cache: fakeCache().cache }, { now, debug: true })
    expect(response.debug!.source).toBe('shortcut')
    expect(response.debug!.rankings.name).toEqual([])

    const pizzas = [
      row({ id: 'fundamento', name: 'Fundamento Pizza', categories: ['pizzeria'], tags: ['pizza'], nameScore: 1 }),
      row({ id: 'pizzeria-quinta', name: 'Pizzeria Quinta', categories: ['pizzeria'], tags: ['pizza'], nameScore: 0.67 }),
    ]
    const pizza = await runSearch('pizza', { store: fakeStore(pizzas).store, cache: fakeCache().cache }, { now, debug: true })
    expect(pizza.debug!.rankings.name.map((entry) => entry.id)).toEqual(['fundamento'])
  })

  it('se usa si la consulta pasó por el modelo', async () => {
    const response = await runSearch('mision comedr', { store: fakeStore(places).store, cache: fakeCache().cache }, { now, debug: true })
    expect(response.debug!.source).toBe('llm')
    expect(response.debug!.rankings.name.map((entry) => entry.id)).toEqual(['comedor'])
  })
})

describe('conocido por el plato', () => {
  it('ícono o categoría del plato pesan más que tenerlo en la carta', async () => {
    const places = [
      row({ id: 'bar-con-pizza', categories: ['bar', 'restaurant'], tags: ['pizza'], dishes: ['pizza'], signature: ['pizza'], iconCategory: 'beer_pub', semantic: 0.6 }),
      row({ id: 'pizzeria', categories: ['pizzeria', 'restaurant'], tags: ['pizza'], signature: ['pizza'], iconCategory: 'pizza', semantic: 0.5 }),
      row({ id: 'pizzeria-sin-icono', categories: ['pizzeria', 'restaurant'], tags: ['pizza'], semantic: 0.5 }),
    ]
    const response = await runSearch('pizza', { store: fakeStore(places).store, cache: fakeCache().cache }, { now, debug: true })
    expect(response.results.map((result) => result.id)).toEqual(['pizzeria', 'pizzeria-sin-icono', 'bar-con-pizza'])
    const boosts = Object.fromEntries(response.debug!.results.map((result) => [result.id, result.boosts]))
    expect(boosts['bar-con-pizza'].knownFor).toBeUndefined()
    expect(boosts.pizzeria.knownFor).toBe(SEARCH_CONFIG.boosts.knownFor)
    expect(boosts['pizzeria-sin-icono'].knownFor).toBe(SEARCH_CONFIG.boosts.knownFor)
    expect(SEARCH_CONFIG.boosts.knownFor).toBeGreaterThan(SEARCH_CONFIG.boosts.exactDish)
  })

  it('hamburguesa → burger, tacos → taco; sin plato no hay boost', () => {
    const burger = row({ id: 'burger', iconCategory: 'burger' })
    expect(boostsFor(burger, context({ dishes: [dishTarget('hamburguesa')] }), null).knownFor).toBe(SEARCH_CONFIG.boosts.knownFor)
    expect(boostsFor(row({ id: 'taqueria', iconCategory: 'taco' }), context({ dishes: [dishTarget('tacos')] }), null).knownFor).toBe(SEARCH_CONFIG.boosts.knownFor)
    expect(boostsFor(burger, context(), null).knownFor).toBeUndefined()
  })
})
