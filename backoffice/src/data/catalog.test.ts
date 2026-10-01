import { describe, expect, it } from 'vitest'
import { FOOD_PLACE_TYPES, isFoodPlaceType } from './food-place-types'
import {
  MONTEVIDEO_NEIGHBORHOODS,
  isMontevideoNeighborhood,
} from './neighborhoods'
import { FEATURES, buildEmbeddingText, buildKeywordText } from './tags'

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
    expect(FEATURES.bar_seating.synonyms.en).toContain('counter')
    const input = {
      name: 'Brunch.', neighborhood: 'Cordón',
      description: { es: 'Brunch.', en: 'Brunch.' },
      tags: ['brunch'], highlights: [{ es: 'Brunch.', en: 'Brunch.' }, { es: 'Café de especialidad.', en: 'Specialty coffee.' }],
    }
    expect(buildEmbeddingText(input)).toBe('Brunch. Cordón, Montevideo. Café de especialidad')
    expect(buildKeywordText(input)).toContain('desayuno tardío')
    expect(buildKeywordText(input)).not.toContain('..')
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
})
