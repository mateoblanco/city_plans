import { describe, expect, it } from 'vitest'
import { overtureNames } from './overture-provider.ts'

describe('nombres de Overture', () => {
  it('extrae nombres comunes y reglas sin confundir metadata con aliases', () => {
    expect(overtureNames({
      names: {
        primary: 'Nombre corporativo SA',
        common: {
          es: 'Café Brasilero',
          en: 'Brazilian Cafe',
        },
        rules: [
          { value: 'CB', variant: 'short', language: 'es' },
          { value: 'Café Brasileiro', variant: 'alternate', language: 'pt' },
        ],
      },
    })).toEqual({
      primary: 'Nombre corporativo SA',
      alternatives: ['Café Brasilero', 'Brazilian Cafe', 'CB', 'Café Brasileiro'],
    })
  })

  it('deduplica aliases y excluye el nombre principal', () => {
    expect(overtureNames({
      names: {
        primary: 'Café Brasilero',
        common: { es: 'Café Brasilero' },
        rules: [{ value: 'Café Brasilero', variant: 'official' }],
      },
    })).toEqual({ primary: 'Café Brasilero', alternatives: [] })
  })
})
