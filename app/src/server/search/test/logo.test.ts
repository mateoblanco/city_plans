import { describe, expect, it } from 'vitest'
import { logoUrl } from '../logo'

describe('logoUrl', () => {
  it('arma LOGO_BASE_URL + "/" + clave, sin barra doble', () => {
    expect(logoUrl('a/b.png', 'https://pub-x.r2.dev')).toBe('https://pub-x.r2.dev/a/b.png')
    expect(logoUrl('a/b.png', 'https://pub-x.r2.dev/')).toBe('https://pub-x.r2.dev/a/b.png')
  })

  it('null sin clave o sin la variable', () => {
    expect(logoUrl(null, 'https://pub-x.r2.dev')).toBeNull()
    expect(logoUrl('a.png', undefined)).toBeNull()
    expect(logoUrl('a.png', '  ')).toBeNull()
  })
})
