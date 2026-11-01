import { describe, expect, it } from 'vitest'
import type { Source } from '../providers/place-extraction-service.ts'
import { priceKindOf, tierFor } from '../providers/price-tiers.ts'
import { percentile, suggestPrice, type PriceSuggestionPlace } from './price-suggestion.ts'

const restaurant: PriceSuggestionPlace = { iconCategory: 'pasta', categories: ['restaurant'], tags: [], style: null }
const source = (text: string, trust: Source['trust'] = 'official'): Source => ({ id: 'S1', kind: 'web', trust, url: 'https://local.example/', text })
const menu = (...prices: number[]) => prices.map((price, index) => `Plato ${index + 1} con guarnición $ ${price}`).join('\n')

describe('price-tiers', () => {
  it('saca el tipo de las categorías de restaurante, después del ícono y después del resto de las categorías', () => {
    expect(priceKindOf('coffee', ['restaurant'])).toBe('restaurant')
    expect(priceKindOf('coffee', ['cafe', 'pizzeria'])).toBe('restaurant')
    expect(priceKindOf('coffee', ['cafe'])).toBe('cafe')
    expect(priceKindOf('cocktails', [])).toBe('bar')
    expect(priceKindOf('burger', ['bar'])).toBe('restaurant')
    expect(priceKindOf(null, ['cafe'])).toBe('cafe')
    expect(priceKindOf(null, ['brewery'])).toBe('bar')
    expect(priceKindOf(null, ['bakery'])).toBe('restaurant')
  })

  it('usa los cortes de cada tipo', () => {
    expect(tierFor('restaurant', 599)).toBe('low')
    expect(tierFor('restaurant', 1500)).toBe('moderate')
    expect(tierFor('restaurant', 1501)).toBe('high')
    expect(tierFor('bar', 1301)).toBe('high')
    expect(tierFor('cafe', 349)).toBe('low')
    expect(tierFor('cafe', 801)).toBe('high')
  })
})

describe('suggestPrice', () => {
  it('el percentil 65 interpola entre vecinos', () => {
    expect(percentile([100, 200, 300, 400, 500], 0.65)).toBe(360)
    expect(percentile([700], 0.65)).toBe(700)
  })

  it('con carta usa el percentil 65 y los cortes del tipo, y cita los precios', () => {
    const suggestion = suggestPrice(restaurant, [source(menu(450, 480, 520, 540, 560, 900))])
    expect(suggestion).toMatchObject({ price: 'low', signal: 'menu', sourceUrl: 'https://local.example/' })
    expect(suggestion?.reason).toContain('percentil 65 $545 de 6 precios')
    expect(suggestion?.snippet).toContain('$ 520')
    expect(suggestPrice({ ...restaurant, iconCategory: 'coffee', categories: ['cafe'] }, [source(menu(450, 480, 520, 540, 560, 900))])?.price).toBe('moderate')
    expect(suggestPrice(restaurant, [source(menu(1600, 1700, 1800, 1900, 2100))])?.price).toBe('high')
  })

  it('la carta necesita cinco precios y deja afuera tiendas y productos', () => {
    expect(suggestPrice(restaurant, [source(menu(400, 450, 500, 520))])).toBeNull()
    expect(suggestPrice(restaurant, [source(`Tienda online\n${menu(2400, 2500, 2600, 2700, 2800)}`)])).toBeNull()
    expect(suggestPrice(restaurant, [source(menu(400, 450, 500, 520).concat('\nCafetera italiana 6 tazas $ 2.900'))])).toBeNull()
    expect(suggestPrice(restaurant, [source(menu(400, 450, 500, 520).concat('\nREMERA ANIVERSARIO 5 AÑOS $800'))])).toBeNull()
  })

  it('prefiere la carta oficial a la de terceros', () => {
    expect(suggestPrice(restaurant, [source(menu(1600, 1700, 1800, 1900, 2100), 'third_party'), { ...source(menu(450, 480, 520, 540, 560)), id: 'S2' }])?.price).toBe('low')
  })

  it('sin carta, una frase vale 2 y gana si supera al otro lado', () => {
    const suggestion = suggestPrice(restaurant, [source('Un lugar con precios accesibles y buena onda.')])
    expect(suggestion).toMatchObject({ price: 'low', signal: 'phrase', snippet: 'Un lugar con precios accesibles y buena onda' })
    expect(suggestPrice(restaurant, [source('Ofrecen un menú degustación de siete pasos.')])?.price).toBe('high')
    expect(suggestPrice({ ...restaurant, tags: ['elegant'], style: 'cuidado' }, [source('Precios accesibles.')])).toBeNull()
  })

  it('ignora negaciones y usos que no hablan del precio del lugar', () => {
    expect(suggestPrice(restaurant, [source('La comida no es barata, pero vale la pena.')])).toBeNull()
    expect(suggestPrice(restaurant, [source('El Mercosur es el cuarto bloque económico del mundo.')])).toBeNull()
    expect(suggestPrice(restaurant, [source('Contenido Exclusivo')])).toBeNull()
    expect(suggestPrice(restaurant, [source('Este restaurante tiene beneficio exclusivo de Salir a Comer.')])).toBeNull()
    expect(suggestPrice(restaurant, [source('En la web tenés un exclusivo descuento del 15% en toda la carta.')])).toBeNull()
    expect(suggestPrice(restaurant, [source('Estudió en la escuela de alta cocina Le Cordon Bleu.')])).toBeNull()
    expect(suggestPrice(restaurant, [source('Un comedor barato para almorzar.')])?.price).toBe('low')
  })

  it('sin snapshot usa sólo tags, categorías, ícono y style', () => {
    expect(suggestPrice({ ...restaurant, tags: ['menu_of_the_day', 'neighborhood_spot'] }, null)).toMatchObject({ price: 'low', signal: 'tags', reason: 'Tags: tags menú del día, de barrio' })
    expect(suggestPrice({ ...restaurant, categories: ['wine_bar'], style: 'cuidado' }, null)?.price).toBe('high')
    expect(suggestPrice({ ...restaurant, iconCategory: 'hot_dog' }, null)).toBeNull()
    expect(suggestPrice({ ...restaurant, tags: ['menu_of_the_day'], style: 'cuidado' }, null)).toBeNull()
  })
})
