import { describe, expect, it } from 'vitest'
import { locationCookieValue, normalizeBounds, parseLocationChoice, parseLocationCookie, parseZone, zoneParam } from '@/lib/location'
import { distanceFactor, inMontevideo, metersToBounds, resolveLocation, zoneOrigin, type LocationInput } from '../location'

const CORDON = { kind: 'coords' as const, lat: -34.905, lng: -56.185 }
const input = (overrides: Partial<LocationInput>): LocationInput => ({
  choice: null,
  user: null,
  defaultNear: true,
  neighborhoods: [],
  venues: [],
  pinned: false,
  textNear: false,
  ...overrides,
})

describe('loc de la URL', () => {
  it('near, all y una zona; un near=lat,lng viejo es cerca mío', () => {
    expect(parseLocationChoice('near')).toEqual({ kind: 'near' })
    expect(parseLocationChoice('all')).toEqual({ kind: 'all' })
    expect(parseLocationChoice('-34.92,-56.16,-34.9,-56.14')).toEqual({ kind: 'zone', bounds: { south: -34.92, west: -56.16, north: -34.9, east: -56.14 } })
    expect(parseLocationChoice(null, '-34.9,-56.1')).toEqual({ kind: 'near' })
    expect(parseLocationChoice(null)).toBeNull()
    expect(parseLocationChoice('otra-cosa')).toBeNull()
  })

  it('la zona se redondea hacia afuera, se recorta a Montevideo y se descarta si no tiene sentido', () => {
    expect(normalizeBounds({ south: -34.92049, west: -56.16051, north: -34.90012, east: -56.14001 })).toEqual({ south: -34.921, west: -56.161, north: -34.9, east: -56.14 })
    expect(parseZone('-36,-57,-34.9,-56.14')).toEqual({ south: -35.05, west: -56.6, north: -34.9, east: -56.14 })
    // Al revés, vacía, fuera de Montevideo o con basura.
    expect(parseZone('-34.9,-56.14,-34.92,-56.16')).toBeNull()
    expect(parseZone('-30,-50,-29,-49')).toBeNull()
    expect(parseZone('-34.9,abc,-34.8,-56.1')).toBeNull()
    expect(parseZone('-34.9,-56.1,-34.8')).toBeNull()
    expect(zoneParam({ south: -34.92, west: -56.16, north: -34.9, east: -56.14 })).toBe('-34.92,-56.16,-34.9,-56.14')
  })
})

describe('cookie loc', () => {
  it('coordenadas redondeadas a 3 decimales, denied o skip; lo demás se ignora', () => {
    expect(parseLocationCookie('-34.90512,-56.18471')).toEqual({ kind: 'coords', lat: -34.905, lng: -56.185 })
    expect(parseLocationCookie('denied')).toEqual({ kind: 'denied' })
    expect(parseLocationCookie('skip')).toEqual({ kind: 'skip' })
    expect(parseLocationCookie('')).toBeNull()
    expect(parseLocationCookie('-134,-56')).toBeNull()
    expect(parseLocationCookie('1,2,3')).toBeNull()
    expect(locationCookieValue(-34.90512, -56.18471)).toBe('-34.905,-56.185')
  })
})

describe('resolveLocation', () => {
  it('por defecto: cerca mío con la ubicación, pedirla sin ella, todo Montevideo si la negó', () => {
    expect(resolveLocation(input({ user: CORDON }))).toEqual({ kind: 'near', origin: { lat: -34.905, lng: -56.185 }, radiusM: 1500 })
    expect(resolveLocation(input({}))).toEqual({ kind: 'ask', explicit: false })
    expect(resolveLocation(input({ user: { kind: 'denied' } }))).toEqual({ kind: 'all', reason: 'denied' })
    expect(resolveLocation(input({ user: { kind: 'skip' } }))).toEqual({ kind: 'all', reason: 'denied' })
  })

  it('un barrio (barra o texto) gana siempre; sin barrio, la zona', () => {
    expect(resolveLocation(input({ user: CORDON, neighborhoods: ['PALERMO'] }))).toEqual({ kind: 'neighborhood' })
    expect(resolveLocation(input({ neighborhoods: ['PALERMO'], choice: { kind: 'near' } }))).toEqual({ kind: 'neighborhood' })
    const bounds = { south: -34.92, west: -56.16, north: -34.9, east: -56.14 }
    expect(resolveLocation(input({ user: CORDON, choice: { kind: 'zone', bounds } }))).toEqual({ kind: 'zone', bounds })
  })

  it('elegido a mano: cerca mío se pide aunque lo haya negado; todo Montevideo gana sobre "cerca mío" del texto', () => {
    expect(resolveLocation(input({ choice: { kind: 'near' }, user: { kind: 'denied' } }))).toEqual({ kind: 'ask', explicit: true })
    expect(resolveLocation(input({ textNear: true }))).toEqual({ kind: 'ask', explicit: true })
    expect(resolveLocation(input({ textNear: true, choice: { kind: 'all' }, user: CORDON }))).toEqual({ kind: 'all', reason: 'chosen' })
  })

  it('sin defaultNear (home, scripts), un nombre fijado o un venue: todo Montevideo', () => {
    expect(resolveLocation(input({ defaultNear: false }))).toEqual({ kind: 'all', reason: 'default' })
    expect(resolveLocation(input({ pinned: true }))).toEqual({ kind: 'all', reason: 'default' })
    expect(resolveLocation(input({ venues: ['Mercado del Puerto'], user: CORDON }))).toEqual({ kind: 'all', reason: 'default' })
  })

  it('fuera de Montevideo: todo Montevideo', () => {
    expect(resolveLocation(input({ user: { kind: 'coords', lat: -34.603, lng: -58.381 } }))).toEqual({ kind: 'all', reason: 'outside' })
  })
})

describe('inMontevideo', () => {
  it('dentro de un barrio o a menos de 500 m del borde', () => {
    expect(inMontevideo({ lat: -34.905, lng: -56.185 })).toBe(true)
    expect(inMontevideo({ lat: -34.603, lng: -58.381 })).toBe(false)
    expect(inMontevideo({ lat: -34.85, lng: -55.6 })).toBe(false)
  })
})

describe('distanceFactor', () => {
  it('1 − 0,3 × km con piso 0,55', () => {
    expect(distanceFactor(null)).toBe(1)
    expect(distanceFactor(0)).toBe(1)
    expect(distanceFactor(400)).toBeCloseTo(0.88)
    expect(distanceFactor(1000)).toBeCloseTo(0.7)
    expect(distanceFactor(3000)).toBe(0.55)
  })
})

describe('desde dónde se ordena la zona', () => {
  const ZONE = { south: -34.92, west: -56.16, north: -34.9, east: -56.14 }

  it('metros al rectángulo: 0 adentro, la distancia al borde afuera', () => {
    expect(metersToBounds({ lat: -34.91, lng: -56.15 }, ZONE)).toBe(0)
    // ~0,01° de latitud al norte del borde: ~1,1 km.
    expect(metersToBounds({ lat: -34.89, lng: -56.15 }, ZONE)).toBeCloseTo(1112, -1)
  })

  it('la persona si está en la zona o cerca del borde; si no, o sin ubicación, el centro', () => {
    expect(zoneOrigin(ZONE, { kind: 'coords', lat: -34.91, lng: -56.15 })).toEqual({ point: { lat: -34.91, lng: -56.15 }, user: true })
    // A ~550 m del borde oeste.
    expect(zoneOrigin(ZONE, { kind: 'coords', lat: -34.91, lng: -56.166 }).user).toBe(true)
    const center = { point: { lat: -34.91, lng: -56.15 }, user: false }
    // Cordón: ~2 km al oeste.
    expect(zoneOrigin(ZONE, CORDON)).toEqual(center)
    expect(zoneOrigin(ZONE, { kind: 'denied' })).toEqual(center)
    expect(zoneOrigin(ZONE, null)).toEqual(center)
  })
})
