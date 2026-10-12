import { describe, expect, it } from 'vitest'
import { FOOD_PLACE_TYPES, isFoodPlaceType } from './food-place-types'
import {
  MONTEVIDEO_NEIGHBORHOODS,
  isMontevideoNeighborhood,
} from './neighborhoods'
import { FEATURES, GOOD_FOR, TAG_IDS, buildEmbeddingText, buildKeywordText, groupOf, tagsForFilter, toCanonical } from './tags'

describe('catálogos permitidos', () => {
  it('incluye los 166 tipos oficiales de Food and Drink sin duplicados', () => {
    expect(FOOD_PLACE_TYPES).toHaveLength(166)
    expect(new Set(FOOD_PLACE_TYPES.map((type) => type.value))).toHaveLength(166)
    expect(isFoodPlaceType('restaurant')).toBe(true)
    expect(isFoodPlaceType('arbitrary_query')).toBe(false)
  })

  it('incluye las 62 áreas barriales de Montevideo sin duplicados', () => {
    expect(MONTEVIDEO_NEIGHBORHOODS).toHaveLength(62)
    expect(new Set(MONTEVIDEO_NEIGHBORHOODS)).toHaveLength(62)
    expect(isMontevideoNeighborhood('Pocitos')).toBe(true)
    expect(isMontevideoNeighborhood('Buenos Aires')).toBe(false)
  })

  it('separa el texto semántico de las palabras clave sin repeticiones', () => {
    expect(FEATURES.open_kitchen.label.es).toBe('Cocina a la vista')
    expect(FEATURES.cash_only.label).toEqual({ es: 'Solo efectivo', en: 'Cash only' })
    expect(FEATURES.cash_only.synonyms.es).toContain('no acepta tarjetas')
    expect(FEATURES.bar_seating.synonyms.en).toContain('counter')
    const input = {
      name: 'Brunch.', neighborhood: 'Cordón',
      description: { es: 'Brunch.', en: 'Brunch.' },
      tags: ['brunch'], highlights: [{ es: 'Brunch.', en: 'Brunch.' }, { es: 'Café de especialidad.', en: 'Specialty coffee.' }],
    }
    expect(buildEmbeddingText(input)).toBe('Brunch. Cordón, Montevideo. Café de especialidad')
    expect(buildKeywordText(input)).toContain('desayuno tardío')
    expect(buildKeywordText(input)).not.toContain('..')
    expect(buildEmbeddingText(input)).not.toContain('Dentro de')
    const inside = { ...input, locatedIn: 'Mercado del Puerto' }
    expect(buildEmbeddingText(inside)).toBe('Brunch. Cordón, Montevideo. Dentro de Mercado del Puerto. Café de especialidad')
    expect(buildKeywordText(inside)).toContain('Dentro de Mercado del Puerto')
  })

  it('limita embeddingText al español y conserva keywordText bilingüe con sinónimos', () => {
    const input = {
      name: 'Café Norte', neighborhood: 'Parque Rodó',
      description: { es: 'Café con terraza.', en: 'Coffee shop with a terrace.' },
      tags: ['cafe', 'terrace'], highlights: [{ es: 'Café filtrado', en: 'Flat white' }],
    }
    const embedding = buildEmbeddingText(input)
    const keyword = buildKeywordText(input)
    expect(embedding).toContain('Café con terraza')
    expect(embedding).toContain('Café')
    expect(embedding).toContain('Terraza')
    expect(embedding).not.toContain('Coffee shop with a terrace')
    expect(embedding).not.toContain('Terrace')
    expect(embedding).not.toContain('rooftop')
    expect(embedding).not.toContain('Flat white')
    expect(keyword).toContain('Coffee shop with a terrace')
    expect(keyword).toContain('coffee shop')
    expect(keyword).toContain('Flat white')
  })

  it('ubica cada tag en su grupo y no repite ids entre grupos', () => {
    expect(groupOf('happy_hour')).toBe('offers')
    expect(groupOf('watch_football')).toBe('features')
    expect(groupOf('kids_friendly')).toBe('goodFor')
    expect(groupOf('cafe')).toBe('categories')
    expect(groupOf('inexistente')).toBeNull()
    expect(new Set(TAG_IDS)).toHaveLength(TAG_IDS.length)
    expect(TAG_IDS).not.toContain('family')
    expect(TAG_IDS).not.toContain('sports_screens')
  })

  it('resuelve los sinónimos nuevos a su tag', () => {
    expect(toCanonical('tenedor libre')).toEqual({ group: 'offers', id: 'all_you_can_eat' })
    expect(toCanonical('happy hour')).toEqual({ group: 'offers', id: 'happy_hour' })
    expect(toCanonical('Pluxee')).toEqual({ group: 'features', id: 'accepts_meal_vouchers' })
    expect(toCanonical('para llevar')).toEqual({ group: 'features', id: 'takeaway' })
    expect(toCanonical('family friendly')).toEqual({ group: 'goodFor', id: 'kids_friendly' })
    expect(GOOD_FOR.work.synonyms.en).toEqual(expect.arrayContaining(['remote workers', 'laptop', 'work from']))
  })

  it('separa el tag genérico al aire libre y lo agrupa en el filtro', () => {
    expect(groupOf('outdoor')).toBe('features')
    expect(toCanonical('al aire libre')).toEqual({ group: 'features', id: 'outdoor' })
    expect(toCanonical('mesas afuera')).toEqual({ group: 'features', id: 'outdoor' })
    expect(toCanonical('vereda')).toEqual({ group: 'features', id: 'sidewalk' })
    expect(tagsForFilter('outdoor')).toEqual(['outdoor', 'patio', 'terrace', 'sidewalk'])
    for (const id of ['events', 'books', 'dancing', 'shop']) expect(groupOf(id)).toBe('features')
    expect(groupOf('lgbtq_friendly')).toBe('goodFor')
    expect(groupOf('tapas')).toBe('foods')
    expect(toCanonical('platitos')).toEqual({ group: 'foods', id: 'tapas' })
    expect(toCanonical('small plates')).toEqual({ group: 'foods', id: 'tapas' })
    expect(toCanonical('tabla')).toEqual({ group: 'foods', id: 'picada' })
    expect(toCanonical('gay friendly')).toEqual({ group: 'goodFor', id: 'lgbtq_friendly' })
    expect(toCanonical('bazar')).toEqual({ group: 'features', id: 'shop' })
    expect(toCanonical('talleres')).toEqual({ group: 'features', id: 'events' })
    expect(toCanonical('workshops')).toEqual({ group: 'features', id: 'events' })
    expect(toCanonical('librería')).toEqual({ group: 'features', id: 'books' })
    expect(toCanonical('funciona como boliche')).toEqual({ group: 'features', id: 'dancing' })
  })
})
