import { describe, expect, it } from 'vitest'
import { parseManualOverrides } from '../../src/data/manual-overrides.ts'
import { isRetiredTagsConflict, planRetiredTags, withoutRetiredTags } from './retired-tags.ts'

const row = (tags: string[], manualOverrides: unknown = {}, signature: string[] = [], categories: string[] = ['bar']) => ({ categories, tags, signature, manualOverrides })

describe('planRetiredTags', () => {
  it('sin tags retirados no hay cambio', () => {
    expect(planRetiredTags(row(['terrace', 'outdoor'], { tags: { add: ['terrace'], remove: [] } }))).toBeNull()
  })

  it('mesas en la vereda pasa a al aire libre sin duplicar y lgbtq_friendly se va', () => {
    expect(withoutRetiredTags(['sidewalk', 'outdoor', 'lgbtq_friendly', 'wifi'])).toEqual(['outdoor', 'wifi'])
    const plan = planRetiredTags(row(['wifi', 'sidewalk', 'lgbtq_friendly'], {}, ['sidewalk', 'wifi']))
    expect(plan).toMatchObject({
      tags: ['wifi', 'outdoor'],
      signature: ['outdoor', 'wifi'],
      effects: [
        { tag: 'sidewalk', replacement: 'outdoor', column: true, overrides: false },
        { tag: 'lgbtq_friendly', replacement: null, column: true, overrides: false },
      ],
    })
  })

  it('los diffs de manual_overrides se migran y las demás claves quedan', () => {
    const overrides = { price: 'low', tags: { add: ['sidewalk', 'outdoor', 'date'], remove: ['lgbtq_friendly', 'patio'] }, signature: ['sidewalk'] }
    const plan = planRetiredTags(row(['outdoor', 'date'], overrides))
    expect(isRetiredTagsConflict(plan)).toBe(false)
    expect(plan).toMatchObject({ tags: ['outdoor', 'date'], manualOverrides: { price: 'low', tags: { add: ['outdoor', 'date'], remove: ['patio'] }, signature: ['outdoor'] } })
    // Con el id viejo, parseManualOverrides descartaba el diff entero; migrado, se lee.
    expect(parseManualOverrides(overrides).tags).toBeUndefined()
    if (plan && !isRetiredTagsConflict(plan)) expect(parseManualOverrides(plan.manualOverrides).tags).toEqual({ add: ['outdoor', 'date'], remove: ['patio'] })
  })

  it('uno agregado a mano y el otro sacado a mano es un conflicto: no se toca', () => {
    expect(planRetiredTags(row(['sidewalk'], { tags: { add: ['sidewalk'], remove: ['outdoor'] } }))).toEqual({ conflict: expect.stringContaining('sidewalk agregado a mano') })
    expect(planRetiredTags(row(['outdoor'], { tags: { add: ['outdoor'], remove: ['sidewalk'] } }))).toEqual({ conflict: expect.stringContaining('sidewalk sacado a mano') })
  })

  it('sacado a mano con al aire libre automático también es un conflicto (pasarlo lo sacaría)', () => {
    expect(isRetiredTagsConflict(planRetiredTags(row(['outdoor'], { tags: { add: [], remove: ['sidewalk'] } })))).toBe(true)
    // Sin al aire libre, el sacado pasa a outdoor: una re-extracción no lo vuelve a poner.
    expect(planRetiredTags(row(['wifi'], { tags: { add: [], remove: ['sidewalk'] } }))).toMatchObject({ tags: ['wifi'], manualOverrides: { tags: { add: [], remove: ['outdoor'] } } })
  })

  it('los tags eliminados en la segunda tanda se sacan de tags, signature y los diffs', () => {
    const retired = ['cider', 'medio_y_medio', 'non_alcoholic', 'dj', 'accepts_meal_vouchers', 'outlets', 'cash_only', 'dancing']
    expect(withoutRetiredTags([...retired, 'wine'])).toEqual(['wine'])
    const plan = planRetiredTags(row(['wine', 'dj', 'cash_only'], { tags: { add: ['dancing', 'wine'], remove: ['outlets'] } }, ['dj', 'wine']))
    expect(plan).toMatchObject({ categories: ['bar'], tags: ['wine'], signature: ['wine'], manualOverrides: { tags: { add: ['wine'], remove: [] } } })
  })

  it('night_club sale de categories y de manual_overrides.categories', () => {
    const plan = planRetiredTags(row(['groups'], { categories: ['bar', 'night_club'] }, [], ['bar', 'night_club']))
    expect(plan).toMatchObject({ categories: ['bar'], tags: ['groups'], manualOverrides: { categories: ['bar'] }, effects: [{ tag: 'night_club', column: true, overrides: true }] })
    if (plan && !isRetiredTagsConflict(plan)) expect(parseManualOverrides(plan.manualOverrides).categories).toEqual(['bar'])
  })

  it('un lugar que se quedaría sin categorías es un conflicto: no se toca', () => {
    expect(planRetiredTags(row([], {}, [], ['night_club']))).toEqual({ conflict: expect.stringContaining('sin categorías') })
    expect(planRetiredTags(row([], { categories: ['night_club'] }, [], ['bar']))).toEqual({ conflict: expect.stringContaining('sin categorías') })
  })
})
