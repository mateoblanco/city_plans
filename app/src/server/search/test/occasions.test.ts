import { describe, expect, it } from 'vitest'
import { findDef, OCCASION_TAGS } from '@shared/tags.ts'
import { SEARCH_CONFIG } from '../config'
import { applyDictionary, interpretWithDictionary } from '../dictionary'
import { dishTarget } from '../dishes'
import { boostsFor, matchLevelOf, type Fused, type FuseContext } from '../fuse'
import { groupSignals, momentSignals, momentsOf } from '../moments'
import { applyRemove, emptyInterpretation, validateInterpretation } from '../interpretation'
import { normalizeQuery } from '../normalize'
import { buildReasons } from '../reasons'
import { runSearch } from '../search'
import { removeChipHref } from '../../../components/pages/SearchPage/utils/search-href'
import { everyDay, fakeCache, fakeStore, llmOutput, row } from './fixtures'

// Lunes 12/10/2026 13:00 en Montevideo.
const now = new Date('2026-10-12T16:00:00Z')
const dictionary = (query: string) => interpretWithDictionary(normalizeQuery(query))
const context = (overrides: Partial<FuseContext> = {}): FuseContext => ({
  pinnedId: null, dishes: [], categories: [], requestedTags: [], preferTags: [], moments: [], cuisines: [], preferStyle: null, price: [], openAt: null, wantsBest: false, wantsDancing: false, intent: null, section: null, diet: [], preferDiet: [], ...overrides,
})

describe('momentos y style en la interpretación', () => {
  it('el atajo los toma como preferencia', () => {
    expect(dictionary('bar con amigos')?.prefer.tags).toEqual(['groups'])
    expect(dictionary('algo rápido')?.prefer.tags).toEqual(['quick'])
    expect(dictionary('para una cita')?.prefer.tags).toEqual(['date'])
    expect(dictionary('festejar un cumpleaños')?.prefer.tags).toEqual(['celebration'])
    expect(dictionary('con los chicos')?.prefer.tags).toEqual(['kids_friendly'])
  })

  it('frente al mar y la rambla piden sea_view como preferencia, sin modelo', () => {
    for (const query of ['frente al mar', 'vista al mar', 'sobre la rambla', 'en la rambla', 'la rambla', 'rambla', 'café frente al mar']) {
      const value = dictionary(query)
      expect(value?.prefer.tags, query).toEqual(['sea_view'])
      expect(value?.must.tags, query).toEqual([])
    }
  })

  it('"bar de barrio" es bar + de barrio (y casual), sin perder "de barrio" en las palabras vacías', () => {
    const result = dictionary('bar de barrio')
    expect(result?.must.categories).toEqual(['bar'])
    expect(result?.prefer.tags).toEqual(['neighborhood_spot'])
    expect(result?.prefer.style).toBe('casual')
    expect(dictionary('restaurante de autor')?.prefer.style).toBe('cuidado')
  })

  it('"bolichito" y "boliche de barrio" son de barrio, no boliche; "boliche" solo sí', () => {
    for (const query of ['bolichito', 'boliche de barrio', 'clasico del barrio', 'bodegon de barrio']) {
      const result = dictionary(query)
      expect(result?.prefer.tags, query).toEqual(['neighborhood_spot'])
      expect(result?.must.categories, query).not.toContain('night_club')
    }
    expect(dictionary('boliche')?.must.categories).toEqual(['night_club'])
    expect(dictionary('algo especial')).toBeNull()
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
    }), '')
    expect(interpretation.must.tags).toEqual(['terrace'])
    expect(interpretation.prefer.tags).toEqual(['groups'])
    expect(interpretation.prefer.style).toBe('casual')
    expect(toPrefer).toEqual(['tag:groups'])
  })

  it('un style en must también es preferencia; en exclude se descarta', () => {
    const { interpretation, discarded } = validateInterpretation(llmOutput({
      must: { ...llmOutput().must, tags: ['cuidado'] },
      exclude: { categories: [], tags: ['casual'] },
    }), '')
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

describe('almuerzo de trabajo', () => {
  it('es almorzar con menú del día y algo rápido como preferencia, nunca work', () => {
    for (const query of ['almuerzo de trabajo', 'almuerzo ejecutivo', 'almorzar cerca del trabajo', 'almuerzo de trabajo rápido']) {
      const value = dictionary(query)
      expect(value?.must.tags, query).toEqual(['lunch'])
      expect(value?.prefer.tags, query).toEqual(['menu_of_the_day', 'quick'])
      expect([...value!.must.tags, ...value!.prefer.tags], query).not.toContain('work')
    }
    expect(dictionary('business lunch')?.language).toBe('en')
  })
})

describe('el momento ordena como un plato', () => {
  it('pedido como preferencia: con el tag es has, sin el tag maybe; con plato y momento, has pide los dos', () => {
    const moments = momentsOf(['date', 'cozy'])
    expect(moments).toEqual(['date'])
    expect(matchLevelOf(row({ id: 'a', tags: ['date'] }), [], [], moments)).toBe('has')
    expect(matchLevelOf(row({ id: 'a', tags: ['cozy'] }), [], [], moments)).toBe('maybe')
    expect(matchLevelOf(row({ id: 'a', tags: ['quick'] }), [], [], momentsOf(['menu_of_the_day', 'quick']))).toBe('has')
    const dish = [dishTarget('milanesa')]
    expect(matchLevelOf(row({ id: 'a', tags: ['date'], dishHas: [true] }), dish, [], moments)).toBe('has')
    expect(matchLevelOf(row({ id: 'a', dishHas: [true] }), dish, [], moments)).toBe('maybe')
    expect(matchLevelOf(row({ id: 'a', tags: ['date'], dishHas: [false] }), dish, [], moments)).toBe('maybe')
  })

  it('"para una cita": el que tiene date va arriba aunque el otro se parezca más; los dos salen', async () => {
    const places = [
      row({ id: 'parecido', semantic: 0.9, prominence: 1 }),
      row({ id: 'cita', tags: ['date'], semantic: 0.5 }),
    ]
    const response = await runSearch('para una cita', { store: fakeStore(places).store, cache: fakeCache().cache }, { now, debug: true })
    expect(response.results.map((result) => result.id)).toEqual(['cita', 'parecido'])
    expect(response.debug?.results.map((result) => result.matchLevel)).toEqual(['has', 'maybe'])
  })

  it('un momento exigido por el modelo pasa a preferencia y ordena igual', async () => {
    const places = [row({ id: 'sin', prominence: 1 }), row({ id: 'grupos', tags: ['groups'] })]
    const cache = fakeCache(llmOutput({ must: { ...llmOutput().must, tags: ['groups'] } })).cache
    const response = await runSearch('algo para ir con la barra de amigos', { store: fakeStore(places).store, cache }, { now, debug: true })
    expect(response.results.map((result) => result.id)).toEqual(['grupos', 'sin'])
  })
})

describe('momentFit', () => {
  it('más señales del momento, más empujón, hasta el tope; vino o cócteles cuenta una vez', () => {
    const { momentFit, maxMomentSignals } = SEARCH_CONFIG.boosts
    const date = context({ moments: ['date'] })
    expect(boostsFor(row({ id: 'a', tags: ['date'] }), date, null).momentFit).toBe(momentFit)
    expect(boostsFor(row({ id: 'a', tags: ['date', 'cozy', 'quiet'] }), date, null).momentFit).toBeCloseTo(3 * momentFit)
    expect(momentSignals(['date'], row({ id: 'a', tags: ['wine', 'classic_cocktails', 'signature_cocktails'] }))).toBe(1)
    expect(momentSignals(['date'], row({ id: 'a', tags: ['date', 'cozy', 'quiet', 'wine', 'dinner'], style: 'cuidado' }))).toBe(maxMomentSignals)
    expect(momentSignals(['date'], row({ id: 'a', style: 'intermedio' }))).toBe(1)
    expect(boostsFor(row({ id: 'a', tags: ['cozy'] }), context(), null).momentFit).toBeUndefined()
  })

  it('celebration cuenta las reservas; con varios momentos vale el que más encaja, sin sumar', () => {
    expect(momentSignals(['celebration'], row({ id: 'a', reservations: 'recommended' }))).toBe(1)
    expect(momentSignals(['celebration'], row({ id: 'a', reservations: 'no_reservations' }))).toBe(0)
    const place = row({ id: 'a', tags: ['celebration', 'groups', 'picada', 'date'] })
    expect(momentSignals(['celebration'], place)).toBe(3)
    expect(momentSignals(['date', 'celebration'], place)).toBe(3)
  })

  it('almuerzo de trabajo: menú del día, algo rápido y almuerzo', () => {
    expect(momentSignals(['menu_of_the_day', 'quick'], row({ id: 'a', tags: ['menu_of_the_day', 'quick', 'lunch'] }))).toBe(3)
    expect(momentSignals(['menu_of_the_day', 'quick'], row({ id: 'a', tags: ['work'] }))).toBe(0)
  })
})

describe('groupFit', () => {
  const { groupFit: tagFit, groupIdentity, groupSignal, maxGroupSignals, momentFit } = SEARCH_CONFIG.boosts
  const groups = context({ moments: ['groups'] })
  const pub = { iconCategory: 'beer_pub' as const }
  const threeSignals = ['draft_beer', 'picada', 'live_music']

  it('el tag y la identidad de pub no se suman entre sí', () => {
    expect(boostsFor(row({ id: 'a', tags: ['groups'] }), groups, null).groupFit).toBeCloseTo(tagFit)
    expect(boostsFor(row({ id: 'a', ...pub }), groups, null).groupFit).toBeCloseTo(groupIdentity)
    expect(boostsFor(row({ id: 'a', categories: ['brewery'] }), groups, null).groupFit).toBeCloseTo(groupIdentity)
    expect(boostsFor(row({ id: 'a', tags: ['groups'], ...pub }), groups, null).groupFit).toBeCloseTo(tagFit)
  })

  it('las señales suman con tope y cada familia cuenta una vez', () => {
    expect(groupSignals(row({ id: 'a', tags: ['draft_beer', 'craft_beer', 'picada', 'tapas'] }))).toBe(2)
    expect(groupSignals(row({ id: 'a', categories: ['pizzeria'], iconCategory: 'pizza' }))).toBe(1)
    expect(boostsFor(row({ id: 'a', tags: ['draft_beer'] }), groups, null).groupFit).toBeCloseTo(groupSignal)
    const many = row({ id: 'a', tags: [...threeSignals, 'pool_table', 'lively', 'classic_cocktails'], categories: ['pizzeria', 'bar'], style: 'casual' })
    expect(groupSignals(many)).toBe(8)
    expect(boostsFor(many, groups, null).groupFit).toBeCloseTo(maxGroupSignals * groupSignal)
  })

  it('no cuenta lo muy común: tag pizza, casual sin bar, drinks ni late_night', () => {
    expect(groupSignals(row({ id: 'a', tags: ['pizza', 'drinks', 'late_night', 'burgers'], categories: ['restaurant'], style: 'casual' }))).toBe(0)
    expect(groupSignals(row({ id: 'a', categories: ['bar'], style: 'cuidado' }))).toBe(0)
    expect(groupSignals(row({ id: 'a', categories: ['bar'], style: 'casual' }))).toBe(1)
  })

  it('sin grupos pedidos no suma nada', () => {
    const place = row({ id: 'a', tags: ['groups', ...threeSignals], ...pub })
    expect(boostsFor(place, context(), null).groupFit).toBeUndefined()
    expect(boostsFor(place, context({ moments: ['date'] }), null).groupFit).toBeUndefined()
    expect(matchLevelOf(row({ id: 'a', tags: threeSignals }), [], [], ['date'])).toBe('maybe')
  })

  it('reemplaza a momentFit para grupos: no cuenta dos veces', () => {
    expect(boostsFor(row({ id: 'a', tags: ['groups', 'picada'] }), groups, null).momentFit).toBeUndefined()
    expect(boostsFor(row({ id: 'a', tags: ['celebration', 'groups'] }), context({ moments: ['celebration'] }), null).momentFit).toBeCloseTo(2 * momentFit)
  })

  it('has con el tag, la identidad o 3 señales; con 2 señales, maybe', () => {
    expect(matchLevelOf(row({ id: 'a', tags: ['groups'] }), [], [], ['groups'])).toBe('has')
    expect(matchLevelOf(row({ id: 'a', ...pub }), [], [], ['groups'])).toBe('has')
    expect(matchLevelOf(row({ id: 'a', tags: threeSignals }), [], [], ['groups'])).toBe('has')
    expect(matchLevelOf(row({ id: 'a', tags: threeSignals.slice(0, 2) }), [], [], ['groups'])).toBe('maybe')
    // Con un plato pedido, has sigue pidiendo los dos.
    expect(matchLevelOf(row({ id: 'a', ...pub, dishHas: [false] }), [dishTarget('chivito')], [], ['groups'])).toBe('maybe')
  })

  it('nadie queda afuera; el motivo "Para ir con amigos" sólo sale con el tag', async () => {
    const places = [row({ id: 'nada', prominence: 1 }), row({ id: 'pub', ...pub }), row({ id: 'grupos', tags: ['groups'] })]
    const response = await runSearch('para un grupo', { store: fakeStore(places).store, cache: fakeCache(llmOutput()).cache }, { now, debug: true })
    expect(response.results.map((result) => result.id).sort()).toEqual(['grupos', 'nada', 'pub'])
    expect(response.results.at(-1)?.id).toBe('nada')
    const reasons = (id: string) => response.results.find((result) => result.id === id)?.reasons
    expect(reasons('grupos')).toContain('Para ir con amigos')
    expect(reasons('pub')).not.toContain('Para ir con amigos')
  })
})

describe('frases de grupo en el diccionario', () => {
  it('van a prefer, nunca a must, sin distinguir grupo grande o chico', () => {
    for (const query of ['con amigas', 'con mis amigos', 'entre amigas', 'para ir con amigos', 'salir con amigas', 'amigos', 'juntada', 'juntada con amigos', 'para juntarse', 'grupo', 'para un grupo', 'grupo grande', 'para un grupo grande', 'grupos grandes', 'mesa grande', 'con los pibes', 'con la barra', 'big group']) {
      const value = dictionary(query)
      expect(value?.prefer.tags, query).toEqual(['groups'])
      expect(value?.must.tags, query).toEqual([])
    }
  })

  it('"con la barra" no se lee como ir solo; "barra" suelta sigue igual', () => {
    expect(dictionary('con la barra')?.prefer.tags).not.toContain('solo')
    expect(dictionary('barra')?.prefer.tags).toEqual(['solo'])
  })

  it('se suman a otro pedido y a lo que devuelve el modelo', () => {
    expect(dictionary('comer con amigas')?.prefer.tags).toEqual(['groups'])
    expect(dictionary('comer con amigas')?.intent).toBe('eat')
    expect(applyDictionary(emptyInterpretation(), 'algo lindo con amigas').prefer.tags).toEqual(['groups'])
  })
})

describe('precio en el atajo', () => {
  it('barato, económico, caro y de lujo', () => {
    expect(dictionary('bar barato')?.must.price).toEqual(['low'])
    expect(dictionary('restaurante económico')?.must.price).toEqual(['low'])
    expect(dictionary('restaurante caro')?.must.price).toEqual(['high'])
    expect(dictionary('restaurante de lujo')?.must.price).toEqual(['high'])
    expect(dictionary('restaurante especial')?.must.price).toEqual(['high'])
    // "cita especial" es una cita con estilo cuidado, no un pedido de precio.
    expect(dictionary('cita especial')?.must.price).toEqual([])
    expect(dictionary('cafe de especialidad')?.must.price ?? []).toEqual([])
  })
})

describe('empujones', () => {
  it('el style pedido suma como una preferencia', () => {
    expect(boostsFor(row({ id: 'a', style: 'casual' }), context({ preferStyle: 'casual' }), null).preferStyle).toBe(SEARCH_CONFIG.boosts.preferStyle)
    expect(boostsFor(row({ id: 'a', style: 'cuidado' }), context({ preferStyle: 'casual' }), null).preferStyle).toBeUndefined()
  })

  it('con precio pedido, el desconocido es maybe y el que coincide has; sin precio pedido, todos has', () => {
    expect(matchLevelOf(row({ id: 'a', price: 'low' }), [], ['low'])).toBe('has')
    expect(matchLevelOf(row({ id: 'a', price: 'unknown' }), [], ['low'])).toBe('maybe')
    expect(matchLevelOf(row({ id: 'a', price: 'unknown' }), [])).toBe('has')
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

  it('"bar barato": sólo los de precio confirmado, sin los de precio desconocido', async () => {
    const response = await runSearch('bar barato', { store: fakeStore([...places].reverse()).store, cache: fakeCache().cache }, { now, debug: true })
    expect(response.debug?.source).toBe('shortcut')
    expect(response.results.map((result) => result.id)).toEqual(['bar-barrio'])
    expect(response.interpreted.chips.map((chip) => `${chip.kind}:${chip.id}`)).toContain('price:low')
  })
})

describe('boliches abajo', () => {
  it('baja un boliche, un lugar "para bailar" y un dj sin comida', () => {
    for (const place of [
      row({ id: 'boliche', categories: ['bar', 'night_club'] }),
      row({ id: 'para-bailar', categories: ['bar'], tags: ['dancing', 'classic_cocktails'] }),
      row({ id: 'dj-solo', categories: ['bar'], tags: ['dj', 'classic_cocktails'] }),
    ]) expect(boostsFor(place, context(), null).danceOnly, place.id).toBe(SEARCH_CONFIG.boosts.danceOnly)
  })

  it('un dj o "para bailar" con comida no baja, y nada baja si la consulta pide bailar', () => {
    expect(boostsFor(row({ id: 'demode', categories: ['bar'], tags: ['dj', 'pizza'] }), context(), null).danceOnly).toBeUndefined()
    expect(boostsFor(row({ id: 'brickel', categories: ['bar'], tags: ['dancing', 'dj', 'burgers', 'picada'] }), context(), null).danceOnly).toBeUndefined()
    expect(boostsFor(row({ id: 'resto-dj', categories: ['restaurant'], tags: ['dj'] }), context(), null).danceOnly).toBeUndefined()
    expect(boostsFor(row({ id: 'boliche', categories: ['night_club'] }), context({ wantsDancing: true }), null).danceOnly).toBeUndefined()
  })
})

describe('con niños', () => {
  const kids = context({ requestedTags: ['kids_friendly'], preferTags: ['kids_friendly'], moments: ['kids_friendly'] })

  it('sube el espacio para niños y baja lo de la noche (una vez), sin excluir', () => {
    const { kidsArea, kidsNight } = SEARCH_CONFIG.boosts
    expect(boostsFor(row({ id: 'cafe-kids', categories: ['cafe'], tags: ['kids_friendly', 'kids_area'] }), kids, null).kidsArea).toBe(kidsArea)
    expect(boostsFor(row({ id: 'resto', categories: ['restaurant'], tags: ['kids_friendly'] }), kids, null)).not.toHaveProperty('kidsNight')
    for (const tags of [['late_night'], ['dj'], ['dancing'], ['late_night', 'dj', 'dancing']]) {
      expect(boostsFor(row({ id: 'bar', categories: ['bar'], tags: ['kids_friendly', 'pizza', ...tags] }), kids, null).kidsNight, tags.join()).toBe(kidsNight)
    }
  })

  it('trasnoche sólo baja a un bar sin restaurant; dj o dancing bajan siempre', () => {
    const { kidsNight } = SEARCH_CONFIG.boosts
    expect(boostsFor(row({ id: 'biga', categories: ['restaurant', 'pizzeria'], tags: ['kids_friendly', 'late_night'] }), kids, null).kidsNight).toBeUndefined()
    expect(boostsFor(row({ id: 'resto-bar', categories: ['bar', 'restaurant'], tags: ['kids_friendly', 'late_night'] }), kids, null).kidsNight).toBeUndefined()
    expect(boostsFor(row({ id: 'cerveceria', categories: ['brewery'], tags: ['kids_friendly', 'late_night'] }), kids, null).kidsNight).toBeUndefined()
    expect(boostsFor(row({ id: 'resto-dj', categories: ['restaurant'], tags: ['kids_friendly', 'dj'] }), kids, null).kidsNight).toBe(kidsNight)
  })

  it('sin niños pedido no aplica', () => {
    const boosts = boostsFor(row({ id: 'bar', categories: ['bar'], tags: ['kids_area', 'late_night'] }), context(), null)
    expect(boosts.kidsArea).toBeUndefined()
    expect(boosts.kidsNight).toBeUndefined()
  })

  it('"comer con amigos" deja al boliche detrás; "para bailar" no lo baja', async () => {
    const places = [
      row({ id: 'living', categories: ['bar', 'night_club'], tags: ['dancing', 'picada', 'groups'], semantic: 0.6 }),
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

  it('sin nombre del modelo: sólo palabras enteras, sin verbos ni palabras vacías', async () => {
    const comer = await runSearch('comer algo', { store: fakeStore(places).store, cache: fakeCache(llmOutput({ intent: 'eat' })).cache }, { now, debug: true })
    expect(comer.debug!.source).toBe('llm')
    expect(comer.debug!.rankings.name).toEqual([])

    const milanesas = [
      row({ id: 'club', name: 'El Club de la Milanesa', categories: ['restaurant'], tags: ['milanesa'], nameScore: 0.5 }),
      row({ id: 'milano', name: 'Milano', categories: ['restaurant'], tags: ['milanesa'], nameScore: 0.4 }),
    ]
    const { store, calls } = fakeStore(milanesas)
    const response = await runSearch('una milanesa al pan', { store, cache: fakeCache().cache }, { now, debug: true })
    expect(response.debug!.rankings.name.map((entry) => entry.id)).toEqual(['club'])
    expect(calls[0].scores.name).toBe('milanesa pan')
  })

  it('si no queda ninguna palabra, no busca por nombre', async () => {
    const { store, calls } = fakeStore(places)
    let searched = false
    store.nameMatches = async () => ((searched = true), [])
    await runSearch('tomar algo', { store, cache: fakeCache().cache }, { now })
    expect(searched).toBe(false)
    expect(calls[0].scores.name).toBeNull()
  })

  it('un lugar se sigue encontrando por su nombre, aunque tenga palabras vacías', async () => {
    const named = [
      row({ id: 'comedor', name: 'Misión Comedor' }),
      row({ id: 'pancho', name: 'Pancho Va!' }),
      row({ id: 'otra', name: 'La Otra' }),
    ]
    for (const [query, id] of [['Misión Comedor', 'comedor'], ['pancho va', 'pancho'], ['la otra', 'otra']]) {
      const names = [{ id, name: named.find((place) => place.id === id)!.name, similarity: 1, wordSimilarity: 1 }]
      const response = await runSearch(query, { store: fakeStore(named, names).store, cache: fakeCache().cache }, { now, debug: true })
      expect(response.results[0].id, query).toBe(id)
      expect(response.debug!.results.find((entry) => entry.id === id)?.pinned, query).toBe(true)
    }
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

describe('nivel de dieta', () => {
  const diet = (vegan: string, vegetarian: string, glutenFree: string) => ({ vegan, vegetarian, glutenFree })

  it('el 100 % apto suma dietFully; con opciones o sin dieta pedida, no', () => {
    const fully = row({ id: 'fully', diet: diet('unknown', 'unknown', 'fully') })
    const options = row({ id: 'options', diet: diet('unknown', 'unknown', 'has_options') })
    expect(boostsFor(fully, context({ diet: ['glutenFree'] }), null).dietFully).toBe(SEARCH_CONFIG.boosts.dietFully)
    expect(boostsFor(options, context({ diet: ['glutenFree'] }), null).dietFully).toBeUndefined()
    expect(boostsFor(fully, context(), null).dietFully).toBeUndefined()
    expect(SEARCH_CONFIG.boosts.dietFully).toBe(SEARCH_CONFIG.boosts.knownFor)
  })

  it('vegano fully cuenta como vegetariano fully; suma por cada dieta pedida', () => {
    const vegan = row({ id: 'vegan', diet: diet('fully', 'has_options', 'fully') })
    expect(boostsFor(vegan, context({ diet: ['vegetarian'] }), null).dietFully).toBe(SEARCH_CONFIG.boosts.dietFully)
    expect(boostsFor(vegan, context({ diet: ['vegan', 'glutenFree'] }), null).dietFully).toBe(2 * SEARCH_CONFIG.boosts.dietFully)
  })

  it('el motivo de un vegano fully en una búsqueda vegetariana es "100 % vegetariano"', () => {
    const interpretation = emptyInterpretation()
    interpretation.must.diet.vegetarian = true
    const item = { row: row({ id: 'vegan', diet: diet('fully', 'has_options', 'unknown') }) } as Fused
    expect(buildReasons(item, { interpretation, dishes: [], dishMode: 'none', intent: null, near: false })).toContain('100 % vegetariano')
  })

  it('con una dieta pedida, su motivo va primero, antes que los platos y Recomendado', () => {
    const interpretation = emptyInterpretation()
    interpretation.must.diet.glutenFree = true
    const item = { row: row({ id: 'resto', featured: true, signature: ['pasta'], diet: diet('unknown', 'unknown', 'has_options') }) } as Fused
    const reasons = buildReasons(item, { interpretation, dishes: [], dishMode: 'none', intent: 'eat', near: false })
    expect(reasons[0]).toBe('Opciones sin TACC')
    expect(reasons).toContain('Recomendado')
  })

  it('en la búsqueda: los 100 % van arriba y entran los mismos', async () => {
    const places = [
      row({ id: 'opciones-1', categories: ['restaurant'], tags: ['gluten_free'], diet: diet('unknown', 'unknown', 'has_options'), semantic: 0.7, prominence: 1 }),
      row({ id: 'opciones-2', categories: ['restaurant'], tags: ['gluten_free'], diet: diet('unknown', 'unknown', 'has_options'), semantic: 0.65, prominence: 1 }),
      row({ id: 'todo', categories: ['restaurant'], tags: ['gluten_free'], diet: diet('unknown', 'unknown', 'fully'), semantic: 0.66, prominence: 0 }),
      row({ id: 'sin-dieta', categories: ['restaurant'], semantic: 0.7 }),
    ]
    const response = await runSearch('sin gluten', { store: fakeStore(places).store, cache: fakeCache().cache }, { now, debug: true })
    expect(response.results.map((result) => result.id)).toEqual(['todo', 'opciones-1', 'opciones-2'])
  })
})
