import { describe, expect, it } from 'vitest'
import { resolveNeighborhood } from '../../../shared/neighborhood-aliases.ts'
import { matchPlace, missingBranches, nearbyPlaces, nameSimilarity, normalizeName, type AutoMatch, type MatchablePlace } from './match.ts'
import type { ReadPlace } from './reader.ts'

function source(patch: Partial<ReadPlace> = {}): ReadPlace {
  return {
    id: 'bbva:x', providerId: 'bbva', sourceName: 'X', category: null, city: null, departments: ['Montevideo'], montevideo: true,
    locations: [], website: null, instagram: null, sourceUrl: 'https://bank.test/x.html', logoUrl: null, description: null, sourceTags: [],
    campaign: { validFrom: null, validTo: null, text: null }, benefits: [], ...patch,
  }
}


const row = (id: string, name: string, neighborhoodId: string, extra: Partial<MatchablePlace> = {}): MatchablePlace => ({ id, name, neighborhoodId, brandKey: null, instagram: null, ...extra })
const at = (area: string) => ({ address: `Calle 1, ${area}`, area, department: null, mapsUrl: null })

describe('normalizeName', () => {
  it('saca tildes, puntuación y palabras genéricas', () => {
    expect(normalizeName('Restaurante Café Suárez')).toBe('suarez')
    expect(normalizeName('Amélie Bar & Bistró')).toBe('amelie')
    expect(normalizeName('Bar')).toBe('bar')
    expect(nameSimilarity('Acevedo Pan Y Cafe', 'Acevedo pan & café')).toBe(1)
  })
})

describe('matchPlace', () => {
  const villaMunoz = resolveNeighborhood('Villa Muñoz')!
  const rows = [
    row('1', 'Es Mercat', 'CIUDAD VIEJA', { instagram: '@esmercatuy' }),
    row('2', 'El Otro Es Mercat', 'CIUDAD VIEJA'),
    row('3', 'Chelato', 'CARRASCO', { brandKey: 'chelato', instagram: 'chelato_uy' }),
    // Los ids del INE vienen tal cual del archivo de barrios.
    row('4', 'Chelato', villaMunoz, { brandKey: 'chelato', instagram: 'chelato_uy' }),
    row('5', 'La Otra', 'POCITOS'),
    row('6', 'Misushi', 'POCITOS'),
  ]
  const linked = (match: AutoMatch) => match.links.map((link) => link.placeId).sort()

  it('found: mismo nombre y mismo barrio, un solo lugar', () => {
    const match = matchPlace(source({ sourceName: 'Es Mercat', instagram: 'esmercatuy', locations: [at('Ciudad Vieja')] }), rows)
    expect(match.status).toBe('found')
    expect(match.links).toEqual([expect.objectContaining({ placeId: '1', origin: 'auto', wholeBrand: false, locationIndex: 0, reasons: expect.arrayContaining(['mismo nombre', 'mismo Instagram', 'mismo barrio']) })])
  })

  it('found por Instagram aunque el nombre cambie (sin direcciones)', () => {
    const match = matchPlace(source({ sourceName: 'Restaurante Es Mercat Puerto', instagram: 'esmercatuy' }), rows)
    expect(match).toMatchObject({ status: 'found', links: [expect.objectContaining({ placeId: '1', wholeBrand: false })] })
  })

  it('cadena sin direcciones: todas las sucursales, como toda la marca', () => {
    const match = matchPlace(source({ sourceName: 'Chelato' }), rows)
    expect(match.status).toBe('found')
    expect(linked(match)).toEqual(['3', '4'])
    expect(match.links.every((link) => link.wholeBrand)).toBe(true)
  })

  it('una sucursal por Instagram compartido también es de la marca', () => {
    const match = matchPlace(source({ sourceName: 'Heladería Chelato Uruguay', instagram: 'chelato_uy' }), rows)
    expect(linked(match)).toEqual(['3', '4'])
  })

  it('cadena con direcciones que cruzan todas: sólo esas sucursales', () => {
    const match = matchPlace(source({ sourceName: 'Chelato', locations: [at('Villa Muñoz')] }), rows)
    expect(match.status).toBe('found')
    expect(match.links).toEqual([expect.objectContaining({ placeId: '4', wholeBrand: false, locationIndex: 0 })])
  })

  it('cadena en parte: las direcciones que no cruzan no tienen sucursal nuestra en su barrio → encontrado, faltan sucursales', () => {
    const place = source({ sourceName: 'Chelato', locations: [at('Villa Muñoz'), at('La Comercial'), { address: 'Calle 9', area: 'Pinar', department: 'Canelones', mapsUrl: null }] })
    const match = matchPlace(place, rows)
    expect(match).toMatchObject({ status: 'found', candidates: [] })
    expect(linked(match)).toEqual(['4'])
    // La de Canelones no cuenta; la de La Comercial no tiene sucursal nuestra.
    expect(missingBranches(place, { ...match, origin: 'auto' })).toBe(1)
    expect(missingBranches(place, { ...match, origin: 'manual' })).toBe(0)
  })

  it('cadena en parte con una dirección sin barrio: hay que decidir (dudoso)', () => {
    const match = matchPlace(source({ sourceName: 'Chelato', locations: [at('Villa Muñoz'), { address: 'Calle sin barrio 123', area: null, department: null, mapsUrl: null }] }), rows)
    expect(match.status).toBe('doubtful')
    expect(linked(match)).toEqual(['4'])
    expect(match.candidates.map((candidate) => candidate.placeId)).toEqual(['3'])
  })

  it('una dirección sin barrio no cruza', () => {
    const match = matchPlace(source({ sourceName: 'Es Mercat', locations: [{ address: 'Colón 1550', area: null, department: null, mapsUrl: null }] }), rows)
    expect(match).toMatchObject({ status: 'doubtful', links: [], candidates: [expect.objectContaining({ placeId: '1' })] })
  })

  it('mismo nombre en otro barrio: dudoso', () => {
    const match = matchPlace(source({ sourceName: 'El Otro Es Mercat', locations: [at('Pocitos')] }), rows)
    expect(match).toMatchObject({ status: 'doubtful', links: [], candidates: [expect.objectContaining({ placeId: '2' })] })
  })

  it('sin direcciones pero con barrio en la ciudad ("Pocitos, Montevideo"): las de ese barrio', () => {
    expect(matchPlace(source({ sourceName: 'Chelato', city: 'Carrasco, Montevideo' }), rows)).toMatchObject({ status: 'found', links: [expect.objectContaining({ placeId: '3', wholeBrand: false })] })
    expect(matchPlace(source({ sourceName: 'Chelato', city: 'Pocitos, Montevideo' }), rows).status).toBe('doubtful')
  })

  it('un nombre corto sin las genéricas no alcanza: "La Otra Parrilla" no es "La Otra"', () => {
    const match = matchPlace(source({ sourceName: 'La otra parrilla', locations: [at('Pocitos')] }), rows)
    expect(match).toMatchObject({ status: 'doubtful', links: [], candidates: [expect.objectContaining({ placeId: '5' })] })
  })

  it('nombre parecido: dudoso con puntaje', () => {
    expect(matchPlace(source({ sourceName: 'Miyagi Sushi', locations: [at('Pocitos')] }), rows).status).toBe('doubtful')
  })

  it('no está en la base', () => {
    expect(matchPlace(source({ sourceName: 'Porterhouse', locations: [at('Pocitos')] }), rows)).toEqual({ status: 'missing', links: [], candidates: [] })
  })

  it('fuera de Montevideo: no se cruza', () => {
    expect(matchPlace(source({ sourceName: 'Es Mercat', montevideo: false }), rows)).toEqual({ status: 'not_matched', links: [], candidates: [] })
  })

  it('un "Centro" de otro departamento no cuenta como dirección de Montevideo', () => {
    const match = matchPlace(source({ sourceName: 'Es Mercat', locations: [{ address: 'Calle 1, Centro', area: 'Centro', department: 'Maldonado', mapsUrl: null }] }), rows)
    expect(match).toMatchObject({ status: 'found', links: [expect.objectContaining({ placeId: '1' })] })
  })
})

describe('matchPlace con coordenadas (Santander)', () => {
  // Bruta, Luis de la Torre 818 (Punta Carretas): coordenadas del link de Santander.
  const bruta = { lat: -34.915858, lng: -56.15599 }
  const offset = (base: { lat: number; lng: number }, meters: number) => ({ lat: base.lat + meters / 111_320, lng: base.lng })
  const rows: MatchablePlace[] = [
    row('b', 'Bruta', 'PUNTA CARRETAS', { location: offset(bruta, 2) }),
    row('n', 'Café de la esquina', 'PUNTA CARRETAS', { location: offset(bruta, 40) }),
    row('p1', 'La Pasiva', 'CARRASCO', { brandKey: 'la-pasiva', location: { lat: -34.8897, lng: -56.0565 } }),
    row('p2', 'La Pasiva', 'POCITOS', { brandKey: 'la-pasiva', location: { lat: -34.9093, lng: -56.1497 } }),
  ]
  const located = (coordinates: { lat: number; lng: number } | null, address = 'Calle 1') => ({ address, area: null, department: null, mapsUrl: null, coordinates })

  it('cerca (≤ 150 m) y con nombre parecido: encontrado, con la distancia', () => {
    const match = matchPlace(source({ sourceName: 'Bruta', locations: [located(bruta, 'Luis de la Torre 818')] }), rows)
    expect(match.status).toBe('found')
    expect(match.links).toEqual([expect.objectContaining({ placeId: 'b', locationIndex: 0, reasons: expect.arrayContaining(['a 2 m de Luis de la Torre 818']) })])
  })

  it('cerca pero con otro nombre: no es candidato (queda como nota al leer) → no está en la base', () => {
    const place = source({ sourceName: 'Porterhouse', locations: [located(offset(bruta, 40))] })
    expect(matchPlace(place, rows)).toEqual({ status: 'missing', links: [], candidates: [] })
    expect(nearbyPlaces(place, new Set(), rows).map((item) => item.placeId)).toContain('n')
  })

  it('el mismo nombre lejos (otra sucursal): dudoso con la distancia; cerca, la sucursal de ese local', () => {
    const arocena = { lat: -34.8898, lng: -56.0566 }
    expect(matchPlace(source({ sourceName: 'La Pasiva', locations: [located(arocena)] }), rows)).toMatchObject({ status: 'found', links: [expect.objectContaining({ placeId: 'p1' })] })
    const far = matchPlace(source({ sourceName: 'La Pasiva', locations: [located(bruta)] }), rows)
    expect(far.status).toBe('doubtful')
    expect(far.candidates.find((candidate) => candidate.placeId === 'p2')?.reasons.at(-1)).toMatch(/^a \d+ m del local más cercano$/)
  })

  it('distancia según el nombre: con señal fuerte hasta 300 m; con sólo un nombre parecido, hasta 150 m', () => {
    const leños = rows.concat([row('l', 'Los Leños', 'CENTRO', { location: offset(bruta, 194) }), row('s', 'Leños Parrilla', 'CENTRO', { location: offset(bruta, 194) })])
    // "Los Leños" = "Los Leños" a 194 m: encontrado.
    expect(matchPlace(source({ sourceName: 'Los Leños', locations: [located(bruta)] }), leños)).toMatchObject({ status: 'found', links: [expect.objectContaining({ placeId: 'l', reasons: expect.arrayContaining(['a 194 m de Calle 1']) })] })
    // Sólo parecido ("Leños Parrilla") a 194 m: no alcanza.
    const similarOnly = matchPlace(source({ sourceName: 'Leños', locations: [located(bruta)] }), [leños[4]])
    expect(similarOnly.links).toEqual([])
    // A 350 m ni con el mismo nombre.
    expect(matchPlace(source({ sourceName: 'Los Leños', locations: [located(bruta)] }), [row('l', 'Los Leños', 'CENTRO', { location: offset(bruta, 350) })]).links).toEqual([])
  })

  it('cadena en parte con coordenadas: los locales sin lugar nuestro (aunque tengan vecinos) → encontrado, faltan sucursales', () => {
    const lejos = { lat: -34.85, lng: -56.25 }
    const place = source({ sourceName: 'Bruta', locations: [located(bruta), located(lejos, 'Lejos 1'), located({ lat: -34.8898, lng: -56.0566 }, 'Arocena 1')] })
    const found = matchPlace(place, rows)
    expect(found).toMatchObject({ status: 'found', links: [expect.objectContaining({ placeId: 'b' })], candidates: [] })
    expect(missingBranches(place, { ...found, origin: 'auto' })).toBe(2)
  })

  it('un local fuera de Montevideo (La Barra) no se cruza; el de Montevideo sí', () => {
    const laBarra = { lat: -34.91489, lng: -54.85679 }
    const match = matchPlace(source({ sourceName: 'Bruta', locations: [located(laBarra), located(bruta)] }), rows)
    expect(match).toMatchObject({ status: 'found', links: [expect.objectContaining({ placeId: 'b', locationIndex: 1 })] })
  })

  it('nada cerca ni parecido: no está en la base', () => {
    expect(matchPlace(source({ sourceName: 'Porterhouse', locations: [located({ lat: -34.8, lng: -56.2 })] }), rows)).toEqual({ status: 'missing', links: [], candidates: [] })
  })

  it('sin coordenadas (BBVA) sigue la regla por barrio', () => {
    expect(matchPlace(source({ sourceName: 'Bruta', locations: [{ address: 'Luis de la Torre 818, Punta Carretas', area: 'Punta Carretas', department: null, mapsUrl: 'https://goo.gl/maps/x' }] }), rows))
      .toMatchObject({ status: 'found', links: [expect.objectContaining({ placeId: 'b', reasons: expect.arrayContaining(['dirección: Luis de la Torre 818, Punta Carretas']) })] })
  })
})
