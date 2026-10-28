import { describe, expect, it } from 'vitest'
import { isValidSlug, metaDescription } from '../place'

describe('metaDescription', () => {
  it('deja igual una descripción corta y junta los espacios', () => {
    expect(metaDescription('  Bar de  barrio\ncon picadas. ')).toBe('Bar de barrio con picadas.')
  })

  it('corta una larga en una palabra, con puntos suspensivos', () => {
    const text = 'Parrilla clásica de Cordón, '.repeat(10)
    const result = metaDescription(text)!
    expect(result.length).toBeLessThanOrEqual(155)
    expect(result.endsWith('…')).toBe(true)
    expect(result).not.toMatch(/[\s,]…$/)
    expect(text.startsWith(result.slice(0, -1))).toBe(true)
  })

  it('undefined si está vacía', () => {
    expect(metaDescription(null)).toBeUndefined()
    expect(metaDescription('   ')).toBeUndefined()
  })
})

describe('isValidSlug', () => {
  it('sólo minúsculas, números y guiones', () => {
    expect(isValidSlug('cafe-misterio-2')).toBe(true)
    expect(isValidSlug('')).toBe(false)
    expect(isValidSlug('Café')).toBe(false)
    expect(isValidSlug("x'; drop")).toBe(false)
    expect(isValidSlug('a'.repeat(201))).toBe(false)
  })
})
