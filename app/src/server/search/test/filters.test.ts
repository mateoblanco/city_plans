import { describe, expect, it } from 'vitest'
import { applyFilters, filterChipKeys, parseFilters, parseNear, roundCoord } from '../filters'
import { emptyInterpretation } from '../interpretation'
import { distanceLabel } from '../labels'

describe('parseFilters', () => {
  it('lee open, diet y neighborhood y descarta lo que no está en los catálogos', () => {
    expect(parseFilters('open:now,diet:vegan,neighborhood:CORDON')).toEqual({
      openNow: true,
      diet: ['vegan'],
      neighborhood: 'CORDON',
    })
    // Las categorías ya no son filtros de la barra: van por la intención.
    expect(parseFilters('open:later,category:cafe,diet:keto,neighborhood:NARNIA,tag:terrace,basura')).toEqual({
      openNow: false,
      diet: [],
      neighborhood: null,
    })
    expect(parseFilters(null)).toEqual(parseFilters(''))
  })

  it('las claves de chip de los filtros coinciden con las de buildChips', () => {
    expect([...filterChipKeys(parseFilters('open:now,diet:glutenFree,neighborhood:POCITOS'))]).toEqual([
      'openAt:now',
      'diet:glutenFree',
      'neighborhood:POCITOS',
    ])
  })
})

describe('parseNear', () => {
  it('redondea a 3 decimales (unos 100 m)', () => {
    expect(parseNear('-34.906789,-56.164321')).toEqual({ lat: -34.907, lng: -56.164 })
    expect(roundCoord(-56.1645)).toBe(-56.164)
    expect(roundCoord(-34.9115)).toBe(-34.911)
  })

  it('rechaza lo que no es una coordenada', () => {
    for (const raw of [null, '', '-34.9', 'a,b', '-34.9,', '100,10', '10,200', '1,2,3']) expect(parseNear(raw)).toBeNull()
  })
})

describe('applyFilters', () => {
  const fromText = () => {
    const value = emptyInterpretation()
    value.must.categories = ['pizzeria']
    value.must.diet = { vegetarian: true }
    value.must.neighborhoods = ['POCITOS']
    value.must.openAt = { day: 6, time: '21:00' }
    return value
  }

  it('suma la dieta a lo interpretado del texto', () => {
    const value = applyFilters(fromText(), parseFilters('diet:vegan'))
    expect(value.must.categories).toEqual(['pizzeria'])
    expect(value.must.diet).toEqual({ vegetarian: true, vegan: true })
    expect(value.must.neighborhoods).toEqual(['POCITOS'])
  })

  it('si contradicen al texto, ganan el barrio y "abierto ahora" del filtro', () => {
    const value = applyFilters(fromText(), parseFilters('neighborhood:CORDON,open:now'))
    expect(value.must.neighborhoods).toEqual(['CORDON'])
    expect(value.must.openAt).toBe('now')
  })

  it('no modifica la interpretación original (la cacheada por q)', () => {
    const original = fromText()
    applyFilters(original, parseFilters('diet:vegan,open:now'))
    expect(original.must.diet).toEqual({ vegetarian: true })
    expect(original.must.categories).toEqual(['pizzeria'])
  })
})

describe('distanceLabel', () => {
  it('de a 100 m hasta 1 km; después km con un decimal', () => {
    expect(distanceLabel(37, 'es')).toBe('a 100 m')
    expect(distanceLabel(412, 'es')).toBe('a 400 m')
    expect(distanceLabel(1180, 'es')).toBe('a 1,2 km')
    expect(distanceLabel(3000, 'es')).toBe('a 3 km')
    expect(distanceLabel(1180, 'en')).toBe('1.2 km away')
  })
})
