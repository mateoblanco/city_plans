import { resolveNeighborhood } from '../../../shared/neighborhood-aliases.ts'
import { fold } from './text.ts'

/** Los 19 departamentos, con el nombre con tildes. */
export const DEPARTMENTS = [
  'Artigas', 'Canelones', 'Cerro Largo', 'Colonia', 'Durazno', 'Flores', 'Florida', 'Lavalleja', 'Maldonado', 'Montevideo',
  'Paysandú', 'Río Negro', 'Rivera', 'Rocha', 'Salto', 'San José', 'Soriano', 'Tacuarembó', 'Treinta y Tres',
] as const

const BY_FOLDED = new Map(DEPARTMENTS.map((name) => [fold(name), name]))

/** Departamentos nombrados en etiquetas (exactas) o en un texto libre (por palabra). */
export function departmentsIn(tags: string[], texts: (string | null)[]): string[] {
  const found = new Set<string>()
  for (const tag of tags) {
    const name = BY_FOLDED.get(fold(tag))
    if (name) found.add(name)
  }
  for (const text of texts) {
    if (!text) continue
    const folded = ` ${fold(text).replace(/[^a-z0-9 ]+/g, ' ')} `
    for (const [key, name] of BY_FOLDED) if (folded.includes(` ${key} `)) found.add(name)
  }
  return DEPARTMENTS.filter((name) => found.has(name))
}

/** Barrio de Montevideo (id del INE) de un texto corto ("Pocitos", "Punta Carretas"); null si no es uno. */
export function montevideoNeighborhood(text: string | null): string | null {
  if (!text) return null
  return resolveNeighborhood(text.trim())
}

/**
 * ¿Está (también) en Montevideo? Por departamento; sin departamento, si la ciudad o algún local nombra un barrio de
 * Montevideo ("Cafetería en Carrasco"). Con departamentos y sin Montevideo entre ellos, no (un "Malvín" de otra ciudad).
 */
export function isMontevideo(departments: string[], places: (string | null)[]): boolean {
  if (departments.includes('Montevideo')) return true
  if (departments.length > 0) return false
  return places.some((place) => place !== null && place.split(',').some((part) => montevideoNeighborhood(part) !== null))
}
