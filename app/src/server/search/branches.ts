import type { Fused } from './fuse'

/** Una card por marca: la sucursal que se muestra y las otras que salieron en la búsqueda (en orden de ranking). */
export type Collapsed = Fused & { branches: Fused[] }

/**
 * Qué sucursal se muestra: la mejor rankeada en un barrio pedido; si no, con cerca mío, la más cercana; si no, la
 * mejor rankeada.
 */
function shownBranch(group: Fused[], context: { neighborhoods: string[]; near: boolean }): Fused {
  const inNeighborhood = group.find((item) => context.neighborhoods.includes(item.row.neighborhoodId))
  if (inNeighborhood) return inNeighborhood
  if (context.near) return group.reduce((best, item) => ((item.row.distance ?? Infinity) < (best.row.distance ?? Infinity) ? item : best))
  return group[0]
}

/**
 * Junta las sucursales de una misma marca (brandKey) en una sola card, en la posición de su mejor sucursal. Las
 * demás no ocupan lugar en la lista ni en las secciones. Los lugares sin marca no cambian. items ya viene ordenado.
 */
export function collapseBranches(items: Fused[], context: { neighborhoods: string[]; near: boolean }): Collapsed[] {
  const byBrand = new Map<string, Fused[]>()
  for (const item of items) {
    if (item.row.brandKey) byBrand.set(item.row.brandKey, [...(byBrand.get(item.row.brandKey) ?? []), item])
  }
  const seen = new Set<string>()
  return items.flatMap((item): Collapsed[] => {
    const key = item.row.brandKey
    if (!key) return [{ ...item, branches: [] }]
    if (seen.has(key)) return []
    seen.add(key)
    const group = byBrand.get(key)!
    const shown = shownBranch(group, context)
    return [{ ...shown, branches: group.filter((branch) => branch !== shown) }]
  })
}
