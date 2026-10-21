import { describe, expect, it } from 'vitest'
import { parseInstagramHandle } from './instagram-handle'

describe('parseInstagramHandle', () => {
  it('acepta @handle, handle o la URL del perfil, y normaliza a minúsculas', () => {
    expect(parseInstagramHandle('@Cafe.Brasilero')).toBe('cafe.brasilero')
    expect(parseInstagramHandle('  panchova_uy ')).toBe('panchova_uy')
    expect(parseInstagramHandle('https://www.instagram.com/brookies.mvd/?hl=es')).toBe('brookies.mvd')
    expect(parseInstagramHandle('instagram.com/living.uy')).toBe('living.uy')
    expect(parseInstagramHandle('http://instagr.am/cardenalcafe')).toBe('cardenalcafe')
  })

  it('rechaza lo que no es un perfil', () => {
    for (const value of ['', '@', 'cafe brasilero', 'café', 'a'.repeat(31), 'https://instagram.com/p/Cx123/', 'https://facebook.com/cafe', 'https://instagram.com/', 'instagram.com.evil.example/cafe']) {
      expect(parseInstagramHandle(value), value).toBeNull()
    }
  })
})
