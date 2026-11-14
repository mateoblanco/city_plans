import { describe, expect, it } from 'vitest'
import { reorderByAffinity } from '../affinity'
import { HOME_CONFIG } from '../config'

const pool = Array.from({ length: 30 }, (_, index) => ({ id: `p${index}` }))
const order = (places: { id: string }[]) => places.map((place) => place.id)

describe('orden personalizado del pool', () => {
  it('sin guardados (sin afinidad) queda igual', () => {
    expect(order(reorderByAffinity(pool, null))).toEqual(order(pool))
    // Con uno solo con afinidad no hay contra qué comparar.
    expect(order(reorderByAffinity(pool, { p20: 0.9 }))).toEqual(order(pool))
  })

  it('suben los parecidos a sus gustos, con peso moderado', () => {
    const affinity = Object.fromEntries(pool.map((place) => [place.id, 0.7]))
    affinity.p10 = 0.9
    const result = order(reorderByAffinity(pool, affinity))
    // p10 sube, pero como mucho 30 × 0,2 = 6 puestos.
    expect(result.indexOf('p10')).toBeLessThan(10)
    expect(result.indexOf('p10')).toBeGreaterThanOrEqual(10 - pool.length * HOME_CONFIG.affinityWeight)
  })

  it('un lugar muy bueno no desaparece: el primero del pool sigue entre los 8 visibles aunque no le guste', () => {
    // Todos le gustan menos el primero.
    const affinity = Object.fromEntries(pool.map((place) => [place.id, 0.9]))
    affinity.p0 = 0.6
    const result = order(reorderByAffinity(pool, affinity))
    expect(result.indexOf('p0')).toBeLessThan(HOME_CONFIG.maxPlaces)
    expect(result.indexOf('p1')).toBeLessThan(HOME_CONFIG.maxPlaces)
  })

  it('los lugares sin afinidad (otro tipo, sin perfil) quedan en el medio, sin castigo fuerte', () => {
    const affinity = { p5: 1, p6: 0 }
    const result = order(reorderByAffinity(pool, affinity))
    expect(result.indexOf('p5')).toBeLessThan(5)
    expect(result.indexOf('p6')).toBeGreaterThan(6)
    // El resto mantiene su orden relativo.
    expect(result.filter((id) => id !== 'p5' && id !== 'p6')).toEqual(order(pool).filter((id) => id !== 'p5' && id !== 'p6'))
  })
})
