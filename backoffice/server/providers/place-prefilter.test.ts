import { describe, expect, it } from 'vitest'
import { SWEEP_TYPES } from './neighborhood-sweep-config.ts'
import { classifyPlace } from './place-prefilter.ts'

const OK = { userRatingCount: 50 }

describe('classifyPlace', () => {
  it('acepta los tipos de ACCEPT, incluidos los subtipos *_restaurant', () => {
    for (const primaryType of [
      'restaurant', 'steak_house', 'cafe', 'coffee_shop', 'cafeteria', 'bar', 'pub', 'wine_bar', 'cocktail_bar',
      'brewery', 'brewpub', 'gastropub', 'bar_and_grill', 'lounge_bar', 'snack_bar', 'ice_cream_shop', 'diner',
      'bistro', 'tea_house', 'juice_shop', 'dessert_shop', 'sandwich_shop', 'food_court',
      'pizza_restaurant', 'sushi_restaurant',
    ]) {
      expect(classifyPlace({ primaryType, businessStatus: 'OPERATIONAL', ...OK })).toEqual({ group: 'accepted', reason: null })
    }
    expect(classifyPlace({ primaryType: 'bar', userRatingCount: 10 })).toEqual({ group: 'accepted', reason: null })
  })

  it('rechaza los tipos de REJECT, incluido night_club', () => {
    for (const primaryType of [
      'supermarket', 'grocery_store', 'convenience_store', 'gas_station', 'hotel', 'lodging', 'catering_service',
      'food_delivery', 'store', 'liquor_store', 'indoor_playground', 'gym', 'school', 'night_club',
    ]) {
      expect(classifyPlace({ primaryType, ...OK })).toEqual({ group: 'rejected', reason: `excluded_type:${primaryType}` })
    }
  })

  it('manda a revisión los tipos que no están en ninguna lista con unknown_type:<tipo>', () => {
    expect(classifyPlace({ primaryType: 'florist', ...OK })).toEqual({ group: 'review', reason: 'unknown_type:florist' })
    expect(classifyPlace({ primaryType: 'meal_delivery', ...OK })).toEqual({ group: 'review', reason: 'unknown_type:meal_delivery' })
    expect(classifyPlace({ primaryType: 'florist', userRatingCount: 1 })).toEqual({ group: 'review', reason: 'unknown_type:florist' })
  })

  it('los tipos REVIEW siempre van a revisión con review_type:<tipo>, tengan o no reseñas', () => {
    for (const primaryType of ['bakery', 'meal_takeaway', 'chocolate_shop', 'food_store', 'confectionery', 'deli']) {
      expect(classifyPlace({ primaryType, ...OK })).toEqual({ group: 'review', reason: `review_type:${primaryType}` })
    }
    expect(classifyPlace({ primaryType: 'bakery' })).toEqual({ group: 'review', reason: 'review_type:bakery' })
  })

  it('respeta el orden: cerrado y REJECT ganan sobre REVIEW, y el primaryType manda sobre los types secundarios', () => {
    expect(classifyPlace({ primaryType: 'bakery', businessStatus: 'CLOSED_PERMANENTLY', ...OK })).toEqual({ group: 'rejected', reason: 'closed_permanently' })
    expect(classifyPlace({ primaryType: 'cafe', types: ['bakery', 'cafe'], ...OK } as never)).toEqual({ group: 'accepted', reason: null })
    expect(classifyPlace({ primaryType: 'coffee_shop', types: ['bakery', 'coffee_shop'], ...OK } as never)).toEqual({ group: 'accepted', reason: null })
  })

  it('manda a revisión cuando falta primaryType', () => {
    expect(classifyPlace({ businessStatus: 'OPERATIONAL', ...OK })).toEqual({ group: 'review', reason: 'primary_type_missing' })
  })

  it('los cerrados siguen en rejected, sea cual sea el tipo', () => {
    expect(classifyPlace({ primaryType: 'bar', businessStatus: 'CLOSED_PERMANENTLY', ...OK })).toEqual({ group: 'rejected', reason: 'closed_permanently' })
    expect(classifyPlace({ primaryType: 'florist', businessStatus: 'CLOSED_TEMPORARILY' })).toEqual({ group: 'rejected', reason: 'closed_temporarily' })
    expect(classifyPlace({ businessStatus: 'CLOSED_TEMPORARILY' })).toEqual({ group: 'rejected', reason: 'closed_temporarily' })
  })

  it('manda a revisión los aceptables con menos de 10 reseñas o sin reseñas', () => {
    expect(classifyPlace({ primaryType: 'bar', userRatingCount: 9 })).toEqual({ group: 'review', reason: 'few_reviews' })
    expect(classifyPlace({ primaryType: 'cafe', userRatingCount: 0 })).toEqual({ group: 'review', reason: 'few_reviews' })
    expect(classifyPlace({ primaryType: 'cafe' })).toEqual({ group: 'review', reason: 'few_reviews' })
    expect(classifyPlace({ primaryType: 'supermarket', userRatingCount: 2 })).toEqual({ group: 'rejected', reason: 'excluded_type:supermarket' })
    expect(classifyPlace({ primaryType: 'bar', userRatingCount: 10, rating: 1 } as never)).toEqual({ group: 'accepted', reason: null })
  })

  it('bakery vuelve a ser un tipo del barrido con sus consultas', () => {
    expect(SWEEP_TYPES).toContainEqual({ googleType: 'bakery', seedCategory: 'bakery', queries: ['panadería', 'confitería'] })
  })
})
