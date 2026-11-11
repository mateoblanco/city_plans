import { fold } from '../../src/lib/discount-names.ts'

/**
 * Shoppings y mercados que las fuentes nombran como sucursal en lugar de una dirección ("Punta Carretas Shopping"): el
 * barrio de Montevideo (como lo lee `montevideoNeighborhood`, verificado con `getBarrio` en sus coordenadas) o el
 * departamento si está afuera. Sólo los conocidos: lo que no está queda sin barrio.
 */
const LANDMARKS: { pattern: RegExp; area: string | null; department: string }[] = [
  { pattern: /^punta carretas( shopping)?$/, area: 'Punta Carretas', department: 'Montevideo' },
  { pattern: /^montevideo shopping$/, area: 'Buceo', department: 'Montevideo' },
  { pattern: /^(shopping )?tres cruces( shopping)?$/, area: 'Tres Cruces', department: 'Montevideo' },
  { pattern: /^(shopping )?portones( shopping)?$/, area: 'Carrasco', department: 'Montevideo' },
  { pattern: /^mercado agricola( de montevideo)?$|^mam$/, area: 'Villa Muñoz', department: 'Montevideo' },
  { pattern: /^mercado del puerto$/, area: 'Ciudad Vieja', department: 'Montevideo' },
  { pattern: /^punta shopping$/, area: null, department: 'Maldonado' },
  { pattern: /^costa urbana( shopping)?$|^las piedras shopping$/, area: null, department: 'Canelones' },
]

/** El barrio y el departamento de un shopping o mercado conocido; null si no está en la tabla. */
export function landmarkLocation(name: string): { area: string | null; department: string } | null {
  const key = fold(name).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  const found = LANDMARKS.find((landmark) => landmark.pattern.test(key))
  return found ? { area: found.area, department: found.department } : null
}
