// Tests generados desde tags.ts: cada categoría, por cada label y sinónimo (es/en), tiene que terminar como
// intención o filtro y traer sólo lugares de ella. Por el atajo del diccionario y por el modelo (mockeado).
import { describe, expect, it } from 'vitest'
import { CATEGORIES, normalize, type CategoryId } from '@shared/tags.ts'
import { intentGroups, matchesGroup } from './intents'
import { runSearch } from './search'
import { fakeCache, fakeStore, llmOutput, row } from './test/fixtures'

const now = new Date('2026-10-12T16:00:00Z')
const ids = Object.keys(CATEGORIES) as CategoryId[]

// Un lugar de cada categoría en Cordón y otro en Pocitos, todos buenos para ir en grupo.
const places = ids.flatMap((id) => [
  row({ id: `${id}-cordon`, categories: [id], tags: ['groups'], neighborhoodId: 'CORDON' }),
  row({ id: `${id}-pocitos`, categories: [id], tags: ['groups'], neighborhoodId: 'POCITOS' }),
])
const byId = new Map(places.map((place) => [place.id, place]))

const termsOf = (id: CategoryId) => {
  const { label, synonyms } = CATEGORIES[id]
  const terms = [label.es, label.en, ...synonyms.es, ...synonyms.en]
  return [...new Map(terms.map((term) => [normalize(term), term])).values()]
}

const variants = (term: string) => [
  { query: term, cordon: false },
  { query: `${term} con amigos`, cordon: false },
  { query: `${term} en cordón`, cordon: true },
]

/** Respuesta del modelo para la consulta: la categoría (más el barrio y los amigos si los dice). */
const llmFor = (id: CategoryId, cordon: boolean, friends: boolean) =>
  llmOutput({
    must: { categories: [id], tags: [], diet: { vegan: false, vegetarian: false, glutenFree: false }, neighborhoods: cordon ? ['Cordón'] : [], price: [], openAt: null },
    prefer: { categories: [], tags: friends ? ['groups'] : [] },
  })

async function check(id: CategoryId, query: string, cordon: boolean, path: 'shortcut' | 'llm') {
  // Una palabra que el diccionario no conoce manda la consulta al modelo.
  const text = path === 'llm' ? `${query} porfa` : query
  const cache = path === 'llm' ? fakeCache(llmFor(id, cordon, query.includes('amigos'))).cache : fakeCache(new Error('no debería llamar al modelo')).cache
  const response = await runSearch(text, { store: fakeStore(places).store, cache }, { now, debug: true })
  const debug = response.debug!
  expect(debug.source, `${text}: camino`).toBe(path)

  const outcome = debug.must.trace.find((entry) => entry.item === `category:${id}`)
  expect(outcome?.outcome, `${text}: category:${id} → ${JSON.stringify(debug.must.trace)}`).toMatch(/^(filter|intent)$/)

  const results = response.results.map((result) => byId.get(result.id)!)
  expect(results.length, `${text}: sin resultados`).toBeGreaterThan(0)
  if (outcome!.outcome === 'filter') {
    for (const place of results) expect(place.categories, `${text}: ${place.id}`).toContain(id)
  } else {
    // Cubierta por la intención: todos son de la intención y el primero es de la categoría.
    const groups = intentGroups(response.bar.intent!.id, response.bar.subs.filter((sub) => sub.active).map((sub) => sub.id))
    for (const place of results) expect(groups.every((group) => matchesGroup(group, place)), `${text}: ${place.id} fuera de ${response.bar.intent!.id}`).toBe(true)
    expect(results[0].categories, `${text}: primero`).toContain(id)
  }
  if (cordon) for (const place of results) expect(place.neighborhoodId, `${text}: ${place.id}`).toBe('CORDON')
}

describe.each(ids)('categoría %s', (id) => {
  for (const term of termsOf(id)) {
    for (const { query, cordon } of variants(term)) {
      it(`"${query}" por el atajo`, () => check(id, query, cordon, 'shortcut'))
      it(`"${query}" por el modelo`, () => check(id, query, cordon, 'llm'))
    }
  }
})
