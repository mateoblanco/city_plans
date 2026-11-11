import { describe, expect, it } from 'vitest'
import { balancedObject, extractPushBenefits } from './extract.ts'
import { fixture } from './fixtures.ts'

describe('extractPushBenefits', () => {
  it('los 419 beneficios del HTML real, del pedido normal y del renderizado', () => {
    for (const name of ['beneficios', 'beneficios-rendered'] as const) {
      const result = extractPushBenefits(fixture(name))
      expect(result).toMatchObject({ calls: 419, issues: [] })
      expect(result.benefits).toHaveLength(419)
    }
    const byMora = extractPushBenefits(fixture('beneficios')).benefits.find((benefit) => benefit.titulo === 'By Mora Sushi Bar')!
    expect(byMora).toMatchObject({ categoria: 'restaurantes', departamento: 'punta del este', dias: 'Todos los días', desde: '2026-01-09', hasta: '2030-12-23' })
    expect(byMora.descuentos).toEqual([
      { pct: '25% de ahorro', texto: 'con tarjetas de Crédito Platinum, Infinite, Gold y Débito Premium.' },
      { pct: '15% de ahorro', texto: 'con tarjetas de Crédito y Débito.' },
    ])
  })

  it('literales de objeto (comillas simples, claves sin comillas, comas al final, comentarios) sin ejecutar nada', () => {
    const html = `<script>
      function pushBenefit(data) { _allBenefits.push(data) }
      pushBenefit({
        titulo: 'Bar {raro}', // un comentario con }
        categoria: "restaurantes",
        /* otro } */ descuentos: [{ pct: '10%', texto: 'con \\'crédito\\'.' },],
      });
      pushBenefit({ titulo: 'Malo', legal: alert('x') });
      pushBenefit({ titulo: (globalThis.hacked = 1) });
    </script><script src="x.js">pushBenefit({ titulo: 'externo' })</script>`
    const result = extractPushBenefits(html)
    expect(result.calls).toBe(3)
    expect(result.benefits).toEqual([{ titulo: 'Bar {raro}', categoria: 'restaurantes', descuentos: [{ pct: '10%', texto: "con 'crédito'." }] }])
    expect(result.issues).toHaveLength(2)
    expect((globalThis as { hacked?: number }).hacked).toBeUndefined()
  })

  it('balancedObject: un objeto que no cierra es null', () => {
    expect(balancedObject("{ a: '}' }", 0)).toBe("{ a: '}' }")
    expect(balancedObject('{ a: { b: 1 }', 0)).toBeNull()
  })
})
