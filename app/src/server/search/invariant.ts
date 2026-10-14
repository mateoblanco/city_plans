import { DIET_KEYS, type ChipKind, type Interpretation } from './interpretation'
import type { SearchFilters } from './filters'
import type { ResolvedIntent } from './intents'

/** Algo de la interpretación que no llegó a la final, con el motivo. */
export type Discard = { value: string; reason: string }

/** Dónde terminó cada cosa exigida por el texto (categoría, tag, dieta o barrio). */
export type MustOutcome = { item: string; outcome: 'filter' | 'intent' | 'discarded'; detail: string }

export type MustCheck = { ok: boolean; trace: MustOutcome[]; violations: string[] }

/** Lo exigido por el texto: `category:bar`, `tag:terrace`, `diet:vegan`, `neighborhood:CORDON`. */
function mustItems(value: Interpretation): { kind: ChipKind; id: string }[] {
  return [
    ...value.must.categories.map((id) => ({ kind: 'category' as const, id })),
    ...value.must.tags.map((id) => ({ kind: 'tag' as const, id })),
    ...DIET_KEYS.filter((key) => value.must.diet[key]).map((id) => ({ kind: 'diet' as const, id })),
    ...value.must.neighborhoods.map((id) => ({ kind: 'neighborhood' as const, id })),
  ]
}

/**
 * Lo que se descartó a propósito de lo exigido por el texto: quitado con `remove` o reemplazado por el barrio de
 * la barra. Se informa en debug junto con lo que el modelo mandó y no existe.
 */
export function intendedDiscards(original: Interpretation, removals: { kind: ChipKind; id: string }[], filters: SearchFilters): Discard[] {
  return mustItems(original).flatMap(({ kind, id }) => {
    const key = `${kind}:${id}`
    if (removals.some((removal) => removal.kind === kind && removal.id === id)) return [{ value: key, reason: 'quitado por la persona (remove)' }]
    if (kind === 'neighborhood' && filters.neighborhood && filters.neighborhood !== id) {
      return [{ value: key, reason: `reemplazado por el barrio de la barra (${filters.neighborhood})` }]
    }
    return []
  })
}

/**
 * Invariante: todo lo que el texto exige (categorías, tags, dietas y barrios de original.must) termina en la
 * interpretación final, en la intención activa (la intención misma o uno de sus sub-filtros) o en `discarded` con
 * un motivo. Nada se pierde en silencio ("bar con amigos" sin la categoría bar). Es antes de relajar: lo que se
 * relaja se avisa aparte.
 */
export function checkMust(original: Interpretation, final: Interpretation, resolved: ResolvedIntent, discarded: Discard[]): MustCheck {
  const covered = new Map<string, string>()
  for (const key of resolved.aliasKeys) covered.set(key, `intención ${resolved.intent}`)
  for (const sub of resolved.subs) for (const key of sub.removeKeys) covered.set(key, `intención ${resolved.intent}, sub-filtro ${sub.id}`)

  const inFinal = new Set(mustItems(final).map(({ kind, id }) => `${kind}:${id}`))
  const trace: MustOutcome[] = []
  const violations: string[] = []
  for (const { kind, id } of mustItems(original)) {
    const item = `${kind}:${id}`
    const discard = discarded.find((entry) => entry.value === item)
    if (inFinal.has(item)) trace.push({ item, outcome: 'filter', detail: 'filtro obligatorio' })
    else if (covered.has(item) && resolved.intent) trace.push({ item, outcome: 'intent', detail: covered.get(item)! })
    else if (discard) trace.push({ item, outcome: 'discarded', detail: discard.reason })
    else violations.push(item)
  }
  return { ok: violations.length === 0, trace, violations }
}

/**
 * En tests y en desarrollo una violación es un error (para que no pase desapercibida); en producción, un warning
 * en el log: la búsqueda sigue.
 */
export function reportMust(check: MustCheck, query: string) {
  if (check.ok) return
  const message = `Búsqueda "${query}": lo exigido por el texto se perdió sin motivo: ${check.violations.join(', ')}`
  if (process.env.NODE_ENV === 'production') console.warn(message)
  else throw new Error(message)
}
