import { describe, expect, it } from 'vitest'
import { fitName, OG_COLORS, OG_DESIGN_VERSION, placeOgAlt, placeOgModel, placeOgVersion } from '../model'

const place = { name: 'Anastasia', logoKey: 'logos/a-0a1b2c3d.webp', logoUrl: 'https://logos.example/logos/a-0a1b2c3d.webp', logoBgColor: '#e22720' }

describe('placeOgModel', () => {
  it('con logo: la banda y el recuadro con el color del logo, borde blanco', () => {
    expect(placeOgModel(place)).toEqual({ kind: 'logo', bandColor: '#e22720', boxColor: '#e22720', borderColor: OG_COLORS.surface, name: 'Anastasia', logoUrl: place.logoUrl })
  })

  it('banda blanca o casi blanca: borde gris, como en la ficha', () => {
    expect(placeOgModel({ ...place, logoBgColor: '#ffffff' }).borderColor).toBe(OG_COLORS.border)
    expect(placeOgModel({ ...place, logoBgColor: '#f7f7f7' }).borderColor).toBe(OG_COLORS.border)
    expect(placeOgModel({ ...place, logoBgColor: '#000000' }).borderColor).toBe(OG_COLORS.surface)
  })

  it('logo sin color (o inválido): banda negra, recuadro blanco y borde blanco', () => {
    for (const logoBgColor of [null, 'red', '#fff', 'url(x)']) {
      expect(placeOgModel({ ...place, logoBgColor })).toMatchObject({ kind: 'logo', bandColor: OG_COLORS.neutralBand, boxColor: OG_COLORS.surface, borderColor: OG_COLORS.surface })
    }
  })

  it('sin logo, o si el logo no cargó: el nombre sobre la banda de la marca', () => {
    const expected = { kind: 'name', bandColor: OG_COLORS.brand, boxColor: OG_COLORS.surface, borderColor: OG_COLORS.surface, logoUrl: null }
    expect(placeOgModel({ ...place, logoKey: null, logoUrl: null })).toMatchObject(expected)
    expect(placeOgModel(place, false)).toMatchObject(expected)
  })
})

describe('placeOgVersion', () => {
  const row = { name: place.name, logoKey: place.logoKey, logoBgColor: place.logoBgColor }

  it('es estable y corta', () => {
    expect(placeOgVersion(row)).toBe(placeOgVersion({ ...row }))
    expect(placeOgVersion(row)).toMatch(/^[0-9a-f]{8}$/)
  })

  it('cambia con el logo, el color o el nombre', () => {
    const base = placeOgVersion(row)
    expect(placeOgVersion({ ...row, logoKey: 'logos/a-ffffffff.webp' })).not.toBe(base)
    expect(placeOgVersion({ ...row, logoKey: null })).not.toBe(base)
    expect(placeOgVersion({ ...row, logoBgColor: '#000000' })).not.toBe(base)
    expect(placeOgVersion({ ...row, name: 'Anastasia Bar' })).not.toBe(base)
  })

  it('no depende de otros datos del lugar', () => {
    expect(placeOgVersion({ ...row, ...{ description_es: 'otra', rating: 4.5 } } as typeof row)).toBe(placeOgVersion(row))
    expect(OG_DESIGN_VERSION).toBeGreaterThan(0)
  })
})

describe('placeOgAlt', () => {
  it('"Logo de <nombre>"', () => {
    expect(placeOgAlt('No Tan Santos')).toBe('Logo de No Tan Santos')
  })
})

describe('fitName', () => {
  it('un nombre corto va grande y en una línea', () => {
    expect(fitName('Brujona')).toEqual({ fontSize: 72, lines: ['Brujona'] })
  })

  it('uno largo baja de tamaño y entra en 3 líneas sin cortar palabras', () => {
    const { fontSize, lines } = fitName('Restaurante Club Pescadores de Montevideo')
    expect(lines.length).toBeLessThanOrEqual(3)
    expect(fontSize).toBeLessThan(72)
    expect(lines.join(' ')).toBe('Restaurante Club Pescadores de Montevideo')
  })

  it('uno larguísimo queda en 3 líneas con "…" en un límite de palabra', () => {
    const name = 'Parrilla y Restaurante El Gran Rincón de los Amigos del Barrio de la Ciudad Vieja de Montevideo'
    const { fontSize, lines } = fitName(name)
    expect(fontSize).toBe(36)
    expect(lines).toHaveLength(3)
    expect(lines[2].endsWith('…')).toBe(true)
    expect(lines[2]).not.toMatch(/\s…$/)
    expect(name.startsWith(lines.join(' ').slice(0, -1))).toBe(true)
  })

  it('una palabra sin espacios más ancha que el recuadro se corta igual', () => {
    const { lines } = fitName('Superextraordinariamentelarguísimonombre')
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.length).toBeLessThanOrEqual(3)
  })

  it('junta los espacios', () => {
    expect(fitName('  Bar   Uno ').lines).toEqual(['Bar Uno'])
  })
})
