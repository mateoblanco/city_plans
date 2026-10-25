import { brandFromGoogleName } from '../providers/brand-name.ts'
import { slugify } from './slug.ts'

/** Lo que hace falta de un lugar para saber de qué marca es. brandKey: la que ya tiene guardada, si tiene. */
export type BrandRow = {
  id: string
  name: string
  neighborhoodId: string
  instagram: string | null
  chainBranch: boolean
  brandKey?: string | null
  /** Para recalcular la prominencia si pasa a sucursal de cadena. */
  igFollowers?: number | null
  /** brand_key editado a mano (manual_overrides): se conserva y, si comparte Instagram, arrastra a los demás. */
  locked?: boolean
}

export type BrandAssignment = {
  /** Por id: la brand_key, o null si el lugar no es de una marca con sucursales. */
  keys: Map<string, string | null>
  /** Para revisar a mano: posibles falsos agrupamientos. */
  warnings: string[]
}

/** Marca del nombre de Google como slug ("Cordón Beer Pocitos" → cordon-beer). */
export const brandSlug = (name: string) => slugify(brandFromGoogleName(name))

export const instagramKey = (instagram: string | null) => instagram?.replace(/^@/, '').trim().toLowerCase() || null

/** El valor más repetido; a igual cantidad, el primero en orden alfabético. */
function mostCommon(values: string[]): string {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
}

/**
 * Agrupa sucursales de una misma marca, sólo con lo que ya está guardado:
 * 1. El mismo Instagram en dos o más lugares: misma key (la que ya tenían, o el slug de marca más repetido). Si dos
 *    Instagram dan el mismo slug, el segundo lleva el handle ("la-pasiva-lapasivaexpress").
 * 2. Sin Instagram compartido y marcado como sucursal de cadena: el slug de la marca (así una sucursal sin Instagram
 *    cae con las demás).
 * 3. El resto, null.
 * Un brand_key editado a mano (locked) no cambia nunca; en un grupo de Instagram, los demás toman su key.
 */
export function assignBrandKeys(rows: BrandRow[]): BrandAssignment {
  const keys = new Map<string, string | null>(rows.map((row) => [row.id, null]))
  const warnings: string[] = []
  const byHandle = new Map<string, BrandRow[]>()
  for (const row of rows) {
    const handle = instagramKey(row.instagram)
    if (handle) byHandle.set(handle, [...(byHandle.get(handle) ?? []), row])
  }

  const fromInstagram = new Map<string, string>()
  for (const [handle, group] of [...byHandle].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (group.length < 2) continue
    const locked = group.flatMap((row) => (row.locked && row.brandKey ? [row.brandKey] : []))
    const saved = group.flatMap((row) => (row.brandKey ? [row.brandKey] : []))
    let key = locked.length ? mostCommon(locked) : saved.length ? mostCommon(saved) : mostCommon(group.map((row) => brandSlug(row.name)))
    if (!locked.length && fromInstagram.has(key) && fromInstagram.get(key) !== handle) key = `${key}-${slugify(handle)}`
    fromInstagram.set(key, handle)
    for (const row of group) if (!row.locked) keys.set(row.id, key)
    const slugs = new Set(group.map((row) => brandSlug(row.name)))
    if (slugs.size > 1) warnings.push(`@${handle}: marcas distintas (${[...slugs].join(', ')}); ¿Instagram compartido que no es cadena?`)
  }

  for (const row of rows) if (row.locked) keys.set(row.id, row.brandKey ?? null)

  for (const row of rows) {
    if (row.locked || keys.get(row.id) !== null || !row.chainBranch) continue
    const key = brandSlug(row.name)
    keys.set(row.id, key)
    if (fromInstagram.has(key)) warnings.push(`${row.name}: se suma a @${fromInstagram.get(key)} por el nombre, sin el mismo Instagram`)
  }

  const sizes = new Map<string, number>()
  for (const key of keys.values()) if (key) sizes.set(key, (sizes.get(key) ?? 0) + 1)
  for (const [key, size] of sizes) if (size === 1) warnings.push(`${key}: cadena con un solo lugar guardado`)
  return { keys, warnings }
}

/** Ids de los lugares cuya brand_key está en dos o más lugares: sucursales de cadena aunque el nombre no lo diga. */
export function sharedBrandKeys(rows: { id: string; brandKey?: string | null }[]): Set<string> {
  const sizes = new Map<string, number>()
  for (const row of rows) if (row.brandKey) sizes.set(row.brandKey, (sizes.get(row.brandKey) ?? 0) + 1)
  return new Set(rows.flatMap((row) => row.brandKey && (sizes.get(row.brandKey) ?? 0) > 1 ? [row.id] : []))
}
