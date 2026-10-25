import { afterEach, describe, expect, it, vi } from 'vitest'
import { interpretWithDictionary } from '../dictionary'
import { emptyFilters, parseFilters, applyFilters } from '../filters'
import { parseIntent, resolveIntent } from '../intents'
import { applyRemove, parseRemove, type Interpretation } from '../interpretation'
import { checkMust, intendedDiscards, reportMust } from '../invariant'
import { normalizeQuery } from '../normalize'

const read = (query: string): Interpretation => interpretWithDictionary(normalizeQuery(query))!

/** El mismo camino que runSearch: remove, intención, filtros de la barra. */
function pipeline(query: string, { remove = '', intent = null as string | null, f = '' } = {}) {
  const original = read(query)
  const removals = parseRemove(remove)
  const filters = f ? parseFilters(f) : emptyFilters()
  const resolved = resolveIntent(applyRemove(original, removals), parseIntent(intent, null), removals)
  const final = applyFilters(resolved.interpretation, filters)
  return checkMust(original, final, resolved, intendedDiscards(original, removals, filters))
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('invariante de lo exigido', () => {
  it('"bar con amigos": la categoría queda en la intención', () => {
    expect(pipeline('bar con amigos')).toEqual({ ok: true, violations: [], trace: [{ item: 'category:bar', outcome: 'intent', detail: 'intención bars' }] })
  })

  it('apagar Bares: la categoría vuelve a ser filtro', () => {
    expect(pipeline('bar con amigos', { remove: 'intent:bars' }).trace).toEqual([{ item: 'category:bar', outcome: 'filter', detail: 'filtro obligatorio' }])
  })

  it('quitada por la persona o reemplazada por la barra: descartada con motivo', () => {
    const check = pipeline('pizzería vegana en cordón', { remove: 'category:pizzeria', f: 'neighborhood:POCITOS' })
    expect(check.ok).toBe(true)
    expect(check.trace).toEqual([
      { item: 'category:pizzeria', outcome: 'discarded', detail: 'quitado por la persona (remove)' },
      { item: 'diet:vegan', outcome: 'filter', detail: 'filtro obligatorio' },
      { item: 'neighborhood:CORDON', outcome: 'discarded', detail: 'reemplazado por los barrios de la barra (POCITOS)' },
    ])
  })

  it('un sub-filtro de la intención cubre el tag', () => {
    expect(pipeline('cócteles').trace).toEqual([{ item: 'tag:classic_cocktails', outcome: 'intent', detail: 'intención bars, sub-filtro cocktails' }])
  })

  it('lo que se pierde sin motivo es una violación y, fuera de producción, un error', () => {
    // El bug de antes: la barra quitaba la categoría al apagar la intención, sin que la persona la quitara.
    const original = read('bar con amigos')
    const resolved = resolveIntent(original, parseIntent(null, null), parseRemove('intent:bars'))
    const lost = { ...resolved.interpretation, must: { ...resolved.interpretation.must, categories: [] } }
    const check = checkMust(original, lost, resolved, [])
    expect(check).toMatchObject({ ok: false, violations: ['category:bar'] })
    expect(() => reportMust(check, 'bar con amigos')).toThrow('lo exigido por el texto se perdió sin motivo: category:bar')

    // En producción la búsqueda sigue y queda un warning en el log.
    vi.stubEnv('NODE_ENV', 'production')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => reportMust(check, 'bar con amigos')).not.toThrow()
    expect(warn).toHaveBeenCalledWith('Búsqueda "bar con amigos": lo exigido por el texto se perdió sin motivo: category:bar')
  })
})
