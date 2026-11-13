/** Cuántos lugares muestra la grilla de la bienvenida. */
export const WELCOME_GRID = 20

/** Fisher-Yates con el random que se pase (en los tests, uno fijo). */
function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1))
    ;[result[index], result[other]] = [result[other], result[index]]
  }
  return result
}

/**
 * count lugares al azar del pool (los más prominentes, ya sin cadenas y uno por marca), variados: va tomando de a uno
 * por tipo (cafés, bares, para comer…) en ronda y, dentro del tipo, el de un barrio que todavía salió menos. Con un pool
 * más chico que count, todos.
 */
export function pickWelcomePlaces<T extends { neighborhoodId: string }>(pool: T[], kindOf: (item: T) => string, count = WELCOME_GRID, random = Math.random): T[] {
  const buckets = new Map<string, T[]>()
  for (const item of shuffle(pool, random)) buckets.set(kindOf(item), [...(buckets.get(kindOf(item)) ?? []), item])
  const hoods = new Map<string, number>()
  const chosen: T[] = []
  while (chosen.length < count && [...buckets.values()].some((bucket) => bucket.length > 0)) {
    for (const bucket of buckets.values()) {
      if (chosen.length >= count || bucket.length === 0) continue
      let best = 0
      for (let index = 1; index < bucket.length; index++) {
        if ((hoods.get(bucket[index].neighborhoodId) ?? 0) < (hoods.get(bucket[best].neighborhoodId) ?? 0)) best = index
      }
      const [item] = bucket.splice(best, 1)
      hoods.set(item.neighborhoodId, (hoods.get(item.neighborhoodId) ?? 0) + 1)
      chosen.push(item)
    }
  }
  return chosen
}
