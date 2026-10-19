import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { INTENT_IDS, INTENTS, NO_INTENT_CATEGORIES, type IntentDef, type IntentMatch } from '@shared/intents.ts'
import { CATEGORIES, TAG_IDS } from '@shared/tags.ts'
import { intentHref } from '@/components/pages/SearchPage/utils/search-href'
import { candidatesQuery } from '../candidates'
import { interpretWithDictionary } from '../dictionary'
import { detectIntent, intentGroups, parseIntent, resolveIntent } from '../intents'
import { emptyInterpretation, parseRemove, type Interpretation } from '../interpretation'
import { normalizeQuery } from '../normalize'
import { noMatchNotice } from '../relax'
import { runSearch } from '../search'
import { fakeCache, fakeStore, row } from './fixtures'

const read = (query: string): Interpretation => interpretWithDictionary(normalizeQuery(query))!
const now = new Date('2026-10-12T16:00:00Z')

describe('configuración', () => {
  it('cada categoría pertenece a una intención o está marcada a propósito como sin intención', () => {
    const inIntent = new Set<string>((Object.values(INTENTS) as IntentDef[]).flatMap((intent) => intent.match.categories ?? []))
    for (const id of Object.keys(CATEGORIES)) {
      const marked = (NO_INTENT_CATEGORIES as string[]).includes(id)
      expect(inIntent.has(id) || marked, `${id}: sin intención y sin marcar en NO_INTENT_CATEGORIES`).toBe(true)
      expect(inIntent.has(id) && marked, `${id}: está en una intención y marcada como sin intención`).toBe(false)
    }
  })

  it('cada tag y categoría de cada sub-filtro existe en tags.ts', () => {
    const tagIds = new Set<string>(TAG_IDS)
    for (const [intentId, intent] of Object.entries(INTENTS) as [string, IntentDef][]) {
      for (const [subId, sub] of Object.entries(intent.subs)) {
        for (const id of sub.tags ?? []) expect(tagIds.has(id), `${intentId}.${subId}: tag ${id}`).toBe(true)
        for (const id of sub.categories ?? []) expect(CATEGORIES, `${intentId}.${subId}: categoría ${id}`).toHaveProperty(id)
      }
    }
  })

  it('sólo usa categorías y tags que existen en tags.ts', () => {
    const tagIds = new Set<string>(TAG_IDS)
    for (const intent of Object.values(INTENTS) as IntentDef[]) {
      const matches: IntentMatch[] = [intent.match, ...Object.values(intent.subs)]
      for (const id of [...matches.flatMap((match) => match.categories ?? []), ...intent.aliases]) expect(CATEGORIES).toHaveProperty(id)
      for (const id of [...matches.flatMap((match) => match.tags ?? []), ...intent.detect]) expect(tagIds.has(id), id).toBe(true)
    }
  })
})

describe('parseIntent', () => {
  it('descarta intenciones desconocidas y sub-filtros de otra intención', () => {
    expect(parseIntent('bars', 'cocktails,live_music,cocktails,breakfast')).toEqual({ intent: 'bars', subs: ['cocktails', 'live_music'] })
    expect(parseIntent('spaceship', 'cocktails')).toEqual({ intent: null, subs: [] })
    expect(parseIntent(null, 'cocktails')).toEqual({ intent: null, subs: [] })
    // "Para comer" ya no existe en Cafés: un link viejo lo pierde y queda Brunch.
    expect(parseIntent('cafes', 'to_eat,brunch')).toEqual({ intent: 'cafes', subs: ['brunch'] })
    expect(Object.keys(INTENTS.cafes.subs)).toEqual(['specialty', 'pastries', 'brunch', 'work'])
  })
})

describe('detectIntent', () => {
  it('el texto elige la intención si encaja en una sola', () => {
    expect(detectIntent(read('pizza en cordón'))).toBe('eat')
    expect(detectIntent(read('cafés en pocitos'))).toBe('cafes')
    expect(detectIntent(read('cócteles'))).toBe('bars')
    expect(detectIntent(read('boliche'))).toBe('bars')
    expect(detectIntent(read('helado'))).toBe('desserts')
    expect(detectIntent(read('café con medialunas'))).toBe('cafes')
  })

  it('ambiguo o sin nada que encaje: ninguna', () => {
    expect(detectIntent(read('bar con pizza'))).toBeNull()
    const chat = emptyInterpretation()
    chat.prefer.tags = ['quiet']
    chat.vibe = 'algo tranqui para charlar'
    expect(detectIntent(chat)).toBeNull()
    expect(detectIntent(read('terraza en cordón'))).toBeNull()
  })
})

describe('resolveIntent', () => {
  const none = { intent: null, subs: [] }

  it('la categoría alias queda cubierta por la intención y pasa a preferencia', () => {
    const resolved = resolveIntent(read('bares en cordón'), none, [])
    expect(resolved).toMatchObject({ intent: 'bars', fromText: true, textIntent: 'bars', aliasKeys: ['category:bar'], subs: [] })
    expect(resolved.interpretation.must.categories).toEqual([])
    expect(resolved.interpretation.prefer.categories).toEqual(['bar'])
  })

  it('lo del texto que es un sub-filtro lo activa; lo demás queda como extra', () => {
    const resolved = resolveIntent(read('cócteles con terraza'), none, [])
    expect(resolved.subs).toEqual([{ id: 'cocktails', fromUrl: false, fromText: true, removeKeys: ['tag:classic_cocktails'] }])
    expect(resolved.interpretation.must.tags).toEqual(['terrace'])
    // Pizzería no es la intención misma: sigue filtrando y se muestra como extra.
    expect(resolveIntent(read('pizzería'), none, []).interpretation.must.categories).toEqual(['pizzeria'])
  })

  it('una preferencia que es un sub-filtro lo activa y sigue siendo preferencia', () => {
    const resolved = resolveIntent(read('cafés para trabajar'), none, [])
    expect(resolved.subs).toEqual([{ id: 'work', fromUrl: false, fromText: true, removeKeys: ['prefer:work'] }])
    expect(resolved.interpretation.prefer.tags).toContain('work')
  })

  it('un plato que es un sub-filtro lo activa y sigue siendo plato', () => {
    const resolved = resolveIntent(read('helado'), none, [])
    expect(resolved.subs.map((sub) => [sub.id, sub.removeKeys])).toEqual([['ice_cream', ['dish:helado']]])
    expect(resolved.absorbedDishes).toEqual(['helado'])
    expect(resolved.interpretation.dishes).toHaveLength(1)
  })

  it('la intención de la URL gana; remove=intent:x apaga la del texto', () => {
    const url = resolveIntent(read('bares'), parseIntent('cafes', 'work'), [])
    expect(url).toMatchObject({ intent: 'cafes', fromText: false, textIntent: 'bars' })
    expect(url.subs.map((sub) => sub.id)).toEqual(['work'])
    // "bar" no es de Cafés: sigue como filtro suelto.
    expect(url.interpretation.must.categories).toEqual(['bar'])

    const removed = resolveIntent(read('pizza'), none, parseRemove('intent:eat'))
    expect(removed).toMatchObject({ intent: null, textIntent: null })
  })

  it('URL y texto en la misma intención: los sub-filtros se juntan', () => {
    const resolved = resolveIntent(read('cócteles'), parseIntent('bars', 'live_music'), [])
    expect(resolved.subs.map((sub) => [sub.id, sub.fromUrl, sub.fromText])).toEqual([
      ['cocktails', false, true],
      ['live_music', true, false],
    ])
  })
})

describe('SQL de la intención', () => {
  it('cada grupo es "cualquiera de" y los grupos se suman con "y"', () => {
    const groups = intentGroups('bars', ['cocktails', 'dancing'])
    const query = new PgDialect().sqlToQuery(
      candidatesQuery(
        { categories: [], tags: [], diet: [], neighborhoods: [], price: [], openAt: null, excludeCategories: [], excludeTags: [], dishes: [], dishMode: 'dish', near: null, groups },
        { embedding: null, keywords: [], name: null, origins: [], pinnedId: null },
      ),
    )
    expect(query.sql).toContain('(categories && $1::text[]) and (tags && $2::text[]) and (categories && $3::text[] or tags && $4::text[])')
    expect(query.params.slice(0, 4)).toEqual([['bar', 'brewery', 'wine_bar', 'night_club'], ['signature_cocktails', 'classic_cocktails'], ['night_club'], ['dj']])
  })

  // Top picks está comentado en shared/intents.ts; el filtro por featured sigue disponible para una intención.
  it('un grupo con featured filtra por featured', () => {
    const query = new PgDialect().sqlToQuery(
      candidatesQuery(
        { categories: [], tags: [], diet: [], neighborhoods: [], price: [], openAt: null, excludeCategories: [], excludeTags: [], dishes: [], dishMode: 'dish', near: null, groups: [{ featured: true }] },
        { embedding: null, keywords: [], name: null, origins: [], pinnedId: null },
      ),
    )
    expect(query.sql).toContain('(featured)')
  })
})

describe('búsqueda con intención', () => {
  const places = [
    row({ id: 'bar-cocteles', categories: ['bar'], tags: ['classic_cocktails'] }),
    row({ id: 'bar-musica', categories: ['bar'], tags: ['live_music'] }),
    row({ id: 'resto-bar', categories: ['restaurant', 'bar'], tags: ['dinner', 'wine'] }),
    row({ id: 'pizzeria', categories: ['pizzeria'], tags: ['pizza', 'dinner'] }),
    row({ id: 'cafe', categories: ['cafe'], tags: ['specialty_coffee'] }),
  ]
  const ids = (response: { results: { id: string }[] }) => response.results.map((result) => result.id).sort()

  it('un lugar entra en varias intenciones', async () => {
    const { store } = fakeStore(places)
    const eat = await runSearch('', { store, cache: fakeCache().cache }, { now, intent: 'eat' })
    const bars = await runSearch('', { store, cache: fakeCache().cache }, { now, intent: 'bars' })
    expect(ids(eat)).toEqual(['pizzeria', 'resto-bar'])
    expect(ids(bars)).toEqual(['bar-cocteles', 'bar-musica', 'resto-bar'])
  })

  it('sub-filtros combinados en cero: pasan a preferencia y se avisa', async () => {
    const { store, calls } = fakeStore(places)
    const response = await runSearch('', { store, cache: fakeCache().cache }, { now, intent: 'bars', sub: 'cocktails,live_music' })
    expect(calls.map((call) => call.filters.groups.length)).toEqual([3, 1])
    expect(response.relaxed.map((notice) => notice.message)).toEqual(['No encontramos bares con tragos y con música en vivo; estos tienen algo de eso.'])
    // Los que tienen algo de lo pedido van primero.
    expect(response.results.slice(0, 2).map((result) => result.id).sort()).toEqual(['bar-cocteles', 'bar-musica'])
    expect(response.bar.subs.filter((sub) => sub.active).map((sub) => sub.id)).toEqual(['cocktails', 'live_music'])
  })

  it('"pizza en cordón": Comer desde el texto y la pizza como extra', async () => {
    const { store } = fakeStore(places)
    const response = await runSearch('pizza en cordón', { store, cache: fakeCache().cache }, { now })
    expect(response.bar.intent).toEqual({ id: 'eat', fromText: true })
    expect(response.bar.textIntent).toBe('eat')
    expect(response.bar.extras.map((chip) => [chip.kind, chip.id])).toEqual([['dish', 'pizza']])
    expect(response.bar.subs.map((sub) => sub.id)).toEqual(['breakfast', 'brunch', 'lunch', 'dinner'])
    expect(ids(response)).toEqual(['pizzeria'])
  })

  it('Top picks no es una intención: intent=top se ignora', async () => {
    expect(INTENT_IDS).not.toContain('top')
    expect(parseIntent('top', 'x')).toEqual({ intent: null, subs: [] })
    const { store } = fakeStore(places)
    const response = await runSearch('', { store, cache: fakeCache().cache }, { now, intent: 'top' })
    expect(response.bar.intent).toBeNull()
    expect(response.relaxed).toEqual([])
    expect(ids(response).sort()).toEqual(places.map((place) => place.id).sort())
  })

  it('el aviso de cero resultados nombra la intención', () => {
    const value = emptyInterpretation()
    value.must.diet = { vegan: true }
    expect(noMatchNotice(value, { diet: true, exclude: false, intent: false }, 'cafes').message).toBe(
      'No encontramos cafés con opciones veganas confirmadas. Probá sacar Vegano de los filtros.',
    )
  })
})

describe('"bar con amigos"', () => {
  const places = [
    row({ id: 'bar', categories: ['bar'], tags: ['groups'] }),
    row({ id: 'resto-bar', categories: ['restaurant', 'bar'] }),
    row({ id: 'heladeria', categories: ['ice_cream_shop'], tags: ['groups'] }),
    row({ id: 'cafe', categories: ['cafe'], tags: ['groups'] }),
  ]
  const ids = (response: { results: { id: string }[] }) => response.results.map((result) => result.id).sort()

  it('la categoría elige Bares y pasa a preferencia', async () => {
    const response = await runSearch('bar con amigos', { store: fakeStore(places).store, cache: fakeCache().cache }, { now, debug: true })
    expect(response.bar.intent).toEqual({ id: 'bars', fromText: true })
    expect(response.debug!.interpretation.must.categories).toEqual([])
    expect(response.debug!.interpretation.prefer.categories).toEqual(['bar'])
    expect(ids(response)).toEqual(['bar', 'resto-bar'])
  })

  it('apagar Bares no pierde la categoría: queda obligatoria y como extra', async () => {
    const first = await runSearch('bar con amigos', { store: fakeStore(places).store, cache: fakeCache().cache }, { now })
    const href = new URL(intentHref({ q: 'bar con amigos' }, null, first.bar), 'http://x').searchParams
    expect(href.get('remove')).toBe('intent:bars')

    const { cache, embedded } = fakeCache()
    const response = await runSearch('bar con amigos', { store: fakeStore(places).store, cache }, { now, remove: href.get('remove'), debug: true })
    expect(response.bar.intent).toBeNull()
    expect(response.debug!.interpretation.must.categories).toEqual(['bar'])
    expect(response.bar.extras.map((chip) => `${chip.kind}:${chip.id}`)).toContain('category:bar')
    expect(ids(response)).toEqual(['bar', 'resto-bar'])
    // Quitar la intención no cambia el texto: se embebe la consulta y sus palabras van a keywords.
    expect(response.debug!.semanticText).toBe('bar con amigos')
    expect(embedded).toEqual(['bar con amigos'])
    expect(response.debug!.keywords).toEqual(['bar', 'amigos'])
  })
})
