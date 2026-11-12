import { label, RETIRED_TAGS } from '../../src/data/tags.ts'

/** Lo que la migración lee de un lugar: categorías, tags, signature y manual_overrides tal como están en la base (sin parsear). */
export type RetiredTagsRow = { categories: string[]; tags: string[]; signature: string[]; manualOverrides: unknown }

/** Dónde aparecía un tag (o categoría) retirado en el lugar. */
export type RetiredTagEffect = { tag: string; replacement: string | null; column: boolean; overrides: boolean }

export type RetiredTagsPlan = {
  categories: string[]
  tags: string[]
  signature: string[]
  /** manual_overrides con los tags retirados reemplazados o sacados; las demás claves quedan igual. */
  manualOverrides: Record<string, unknown>
  effects: RetiredTagEffect[]
}

export type RetiredTagsConflict = { conflict: string }

const isRetired = (id: string) => Object.hasOwn(RETIRED_TAGS, id)
const strings = (value: unknown): string[] | null => (Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null)

/** Reemplaza los tags retirados por el suyo (o los saca), sin repetir y en el mismo orden. */
export function withoutRetiredTags(ids: readonly string[]): string[] {
  return [...new Set(ids.flatMap((id) => (isRetired(id) ? (RETIRED_TAGS[id] ?? []) : [id])))]
}

/**
 * Migración de los tags y categorías que salieron del catálogo (RETIRED_TAGS) en un lugar guardado: las columnas
 * categories, tags y signature y los overrides de manual_overrides (tags.add/remove, signature y categories). null si el
 * lugar no tiene ninguno. Lee manual_overrides crudo: parseManualOverrides descarta entero un diff con un id que ya no
 * está en el catálogo. Un lugar con el tag retirado agregado a mano y su reemplazo sacado a mano (o al revés), con el
 * retirado sacado a mano y el reemplazo puesto automático, o que se quedaría sin categorías, es un conflicto: no se
 * toca y se avisa.
 */
export function planRetiredTags(row: RetiredTagsRow): RetiredTagsPlan | RetiredTagsConflict | null {
  const overrides = typeof row.manualOverrides === 'object' && row.manualOverrides !== null && !Array.isArray(row.manualOverrides)
    ? row.manualOverrides as Record<string, unknown>
    : {}
  const diff = typeof overrides.tags === 'object' && overrides.tags !== null ? overrides.tags as Record<string, unknown> : null
  const add = strings(diff?.add) ?? []
  const remove = strings(diff?.remove) ?? []
  const lockedSignature = strings(overrides.signature)
  const lockedCategories = strings(overrides.categories)

  const effects = Object.entries(RETIRED_TAGS).flatMap(([tag, replacement]): RetiredTagEffect[] => {
    const column = row.tags.includes(tag) || row.signature.includes(tag) || row.categories.includes(tag)
    const inOverrides = add.includes(tag) || remove.includes(tag) || Boolean(lockedSignature?.includes(tag)) || Boolean(lockedCategories?.includes(tag))
    return column || inOverrides ? [{ tag, replacement, column, overrides: inOverrides }] : []
  })
  if (effects.length === 0) return null

  for (const { tag, replacement } of effects) {
    if (!replacement) continue
    const [retired, current] = [tag, `${replacement} (${label(replacement)})`]
    if (add.includes(tag) && remove.includes(replacement)) return { conflict: `${retired} agregado a mano y ${current} sacado a mano` }
    if (remove.includes(tag) && add.includes(replacement)) return { conflict: `${retired} sacado a mano y ${current} agregado a mano` }
    if (remove.includes(tag) && row.tags.includes(replacement)) return { conflict: `${retired} sacado a mano y ${current} automático: pasar el sacado a ${replacement} lo sacaría` }
  }

  const categories = withoutRetiredTags(row.categories)
  const nextLockedCategories = lockedCategories ? withoutRetiredTags(lockedCategories) : null
  if (categories.length === 0 || nextLockedCategories?.length === 0) {
    return { conflict: `se quedaría sin categorías (${row.categories.join(', ')}): elegir otra a mano` }
  }

  const tags = withoutRetiredTags(row.tags)
  const manualOverrides = { ...overrides }
  if (diff) manualOverrides.tags = { ...diff, add: withoutRetiredTags(add), remove: withoutRetiredTags(remove) }
  if (lockedSignature) manualOverrides.signature = withoutRetiredTags(lockedSignature)
  if (nextLockedCategories) manualOverrides.categories = nextLockedCategories
  return { categories, tags, signature: withoutRetiredTags(row.signature).filter((id) => tags.includes(id)), manualOverrides, effects }
}

export const isRetiredTagsConflict = (plan: RetiredTagsPlan | RetiredTagsConflict | null): plan is RetiredTagsConflict =>
  plan !== null && 'conflict' in plan
