import { describe, expect, it } from 'vitest'
import { assignBrandKeys, sharedBrandKeys, type BrandRow } from './brand-key.ts'

const row = (id: string, name: string, overrides: Partial<BrandRow> = {}): BrandRow =>
  ({ id, name, neighborhoodId: 'cordon', instagram: null, chainBranch: false, ...overrides })

describe('assignBrandKeys', () => {
  it('el mismo Instagram en dos o más lugares da la misma key, con el slug de marca más repetido', () => {
    const { keys } = assignBrandKeys([
      row('a', 'Cordón Beer', { instagram: 'cordonbeer' }),
      row('b', 'Cordón Beer Pocitos', { instagram: '@CordonBeer' }),
      row('c', 'Cordón Beer Bar', { instagram: 'cordonbeer' }),
    ])
    expect([...keys.values()]).toEqual(['cordon-beer', 'cordon-beer', 'cordon-beer'])
  })

  it('un Instagram de un solo lugar no es marca, salvo que sea sucursal de cadena', () => {
    const { keys } = assignBrandKeys([
      row('a', 'El Palenque', { instagram: 'elpalenque' }),
      row('b', 'La Pasiva Ciudad Vieja', { instagram: 'lapasivacv', chainBranch: true }),
      row('c', 'Bar Tinto'),
    ])
    expect(keys).toEqual(new Map([['a', null], ['b', 'la-pasiva'], ['c', null]]))
  })

  it('una sucursal sin Instagram se suma por la marca, con aviso', () => {
    const { keys, warnings } = assignBrandKeys([
      row('a', 'Cordón Beer', { instagram: 'cordonbeer' }),
      row('b', 'Cordón Beer Pocitos', { instagram: 'cordonbeer' }),
      row('c', 'Cordón Beer Malvín', { chainBranch: true }),
    ])
    expect(keys.get('c')).toBe('cordon-beer')
    expect(warnings).toContain('Cordón Beer Malvín: se suma a @cordonbeer por el nombre, sin el mismo Instagram')
  })

  it('dos Instagram con el mismo slug no se juntan', () => {
    const { keys } = assignBrandKeys([
      row('a', 'Lupa', { instagram: 'lupa.uy' }),
      row('b', 'Lupa Pocitos', { instagram: 'lupa.uy' }),
      row('c', 'Lupa', { instagram: 'lupabar' }),
      row('d', 'Lupa Centro', { instagram: 'lupabar' }),
    ])
    expect([keys.get('a'), keys.get('c')]).toEqual(['lupa', 'lupa-lupabar'])
  })

  it('un brand_key editado a mano no cambia y las sucursales con su Instagram toman esa key', () => {
    const { keys } = assignBrandKeys([
      row('a', 'Cordón Beer', { instagram: 'cordonbeer', brandKey: 'cordon', locked: true }),
      row('b', 'Cordón Beer Pocitos', { instagram: 'cordonbeer', brandKey: 'cordon-beer' }),
      row('c', 'Bar Tinto', { brandKey: 'tinto', locked: true }),
      row('d', 'La Pasiva Centro', { chainBranch: true, brandKey: null, locked: true }),
    ])
    expect(keys).toEqual(new Map([['a', 'cordon'], ['b', 'cordon'], ['c', 'tinto'], ['d', null]]))
  })

  it('avisa si un Instagram compartido junta marcas distintas', () => {
    const { warnings } = assignBrandKeys([
      row('a', 'Duna', { instagram: 'lanocheuy_' }),
      row('b', 'Doña Marta', { instagram: 'lanocheuy_' }),
    ])
    expect(warnings[0]).toMatch(/^@lanocheuy_: marcas distintas/)
  })
})

describe('sharedBrandKeys', () => {
  it('marca los lugares cuya brand_key está en dos o más', () => {
    expect(sharedBrandKeys([
      { id: 'a', brandKey: 'plaza-de-chueca' },
      { id: 'b', brandKey: 'plaza-de-chueca' },
      { id: 'c', brandKey: 'solo' },
      { id: 'd', brandKey: null },
    ])).toEqual(new Set(['a', 'b']))
  })
})
