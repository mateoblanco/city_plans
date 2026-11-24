import { describe, expect, it } from 'vitest'
import { decide } from '../decide'

const here = { lat: -34.9, lng: -56.16 }
// Un grado de latitud son ~111.195 m: 0,0009° ≈ 100 m.
const north = (meters: number) => ({ lat: here.lat + meters / 111195, lng: here.lng })
const ok = (point: { lat: number; lng: number }, movedPlaceId: string | null = null) => ({ kind: 'ok' as const, ...point, movedPlaceId })

describe('decide', () => {
  it('menos de 100 m: actualiza sin avisar y cierra un "no encontrado" o "reemplazado" viejo', () => {
    expect(decide(here, ok(north(99)))).toEqual({ update: north(99), flags: [], resolve: ['not_found', 'replaced'] })
  })

  it('más de 100 m: actualiza igual y marca "se movió" con los metros', () => {
    const decision = decide(here, ok(north(101)))
    expect(decision.update).toEqual(north(101))
    expect(decision.flags).toEqual([{ reason: 'moved', distanceM: 101 }])
  })

  it('el umbral se puede cambiar', () => {
    expect(decide(here, ok(north(60)), 50).flags).toEqual([{ reason: 'moved', distanceM: 60 }])
  })

  it('movedPlaceId: marca "reemplazado" con el id nuevo y no cierra ese aviso', () => {
    const decision = decide(here, ok(here, 'ChIJnuevo'))
    expect(decision.update).toEqual(here)
    expect(decision.flags).toEqual([{ reason: 'replaced', newGooglePlaceId: 'ChIJnuevo' }])
    expect(decision.resolve).toEqual(['not_found'])
  })

  it('place_id inválido: marca "no encontrado" sin tocar la ubicación', () => {
    expect(decide(here, { kind: 'not_found' })).toEqual({ update: null, flags: [{ reason: 'not_found' }], resolve: [] })
  })
})
