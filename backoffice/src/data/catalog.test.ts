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
    expect(buildEmbeddingText(input)).toBe('Brunch. Cordón, Montevideo')
    expect(buildKeywordText(input)).toContain('desayuno tardío')
    expect(buildKeywordText(input)).not.toContain('..')
    expect(buildEmbeddingText(input)).not.toContain('Dentro de')
    const inside = { ...input, locatedIn: 'Mercado del Puerto' }
    expect(buildEmbeddingText(inside)).toBe('Brunch. Cordón, Montevideo. Dentro de Mercado del Puerto')
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
    expect(embedding).toBe('Café Norte. Parque Rodó, Montevideo. Café con terraza. Café')
    expect(embedding).not.toContain('Coffee shop with a terrace')
    expect(embedding).not.toContain('Terrace')
    expect(embedding).not.toContain('rooftop')
    expect(embedding).not.toContain('Flat white')
    expect(keyword).toContain('Coffee shop with a terrace')
    expect(keyword).toContain('coffee shop')
    expect(keyword).toContain('Flat white')
  })

  it('arma embeddingText con la identidad del lugar y deja platos y filtros en keywordText', () => {
    const input = {
      name: 'El Bodegón', neighborhood: 'Centro',
      description: { es: 'Bodegón clásico de barrio.', en: 'Classic neighborhood tavern.' },
      tags: ['bodegon', 'uruguayan', 'cozy', 'groups', 'milanesa', 'wine', 'wifi', 'lunch'],
      highlights: [{ es: 'Milanesa al pan', en: 'Milanesa sandwich' }],
      dishes: ['milanesa napolitana', 'chivito canadiense'],
      signature: ['milanesa'],
    }
    const embedding = buildEmbeddingText(input)
    expect(embedding).toBe('El Bodegón. Centro, Montevideo. Bodegón clásico de barrio. Bodegón. Uruguaya. Acogedor. Grupos. Milanesas')
    for (const excluded of ['Vino', 'Wifi', 'Almuerzo', 'Milanesa al pan', 'milanesa napolitana']) expect(embedding).not.toContain(excluded)
    const keyword = buildKeywordText(input)
    expect(keyword).toContain('milanesa napolitana')
    expect(keyword).toContain('chivito canadiense')
    expect(keyword).toContain('Wifi')
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
    expect(TAG_IDS).not.toContain('merienda_for_two')
  })

  it('resuelve los sinónimos nuevos a su tag', () => {
    expect(toCanonical('pantalla grande')).toEqual({ group: 'features', id: 'watch_football' })
    expect(toCanonical('pedidosya')).toEqual({ group: 'features', id: 'delivery' })
    expect(toCanonical('entrega a domicilio')).toEqual({ group: 'features', id: 'delivery' })
    expect(toCanonical('tributos musicales')).toEqual({ group: 'features', id: 'live_music' })
    expect(toCanonical('exposiciones')).toEqual({ group: 'features', id: 'events' })
    expect(toCanonical('casamientos')).toEqual({ group: 'goodFor', id: 'celebration' })
    expect(toCanonical('menú infantil')).toEqual({ group: 'goodFor', id: 'kids_friendly' })
    expect(toCanonical('a la sombra')).toEqual({ group: 'features', id: 'outdoor' })
    expect(toCanonical('tenedor libre')).toEqual({ group: 'offers', id: 'all_you_can_eat' })
    expect(toCanonical('happy hour')).toEqual({ group: 'offers', id: 'happy_hour' })
    expect(toCanonical('Pluxee')).toEqual({ group: 'features', id: 'accepts_meal_vouchers' })
    expect(toCanonical('para llevar')).toEqual({ group: 'features', id: 'takeaway' })
    expect(toCanonical('family friendly')).toEqual({ group: 'goodFor', id: 'kids_friendly' })
    expect(toCanonical('bodegon')).toEqual({ group: 'categories', id: 'bodegon' })
    expect(toCanonical('bodegones')).toEqual({ group: 'categories', id: 'bodegon' })
    expect(toCanonical('minutas')).toEqual({ group: 'cuisines', id: 'uruguayan' })
    expect(toCanonical('tranquilo')).toEqual({ group: 'atmosphere', id: 'quiet' })
    expect(toCanonical('lively')).toEqual({ group: 'atmosphere', id: 'lively' })
    expect(toCanonical('acogedor')).toEqual({ group: 'atmosphere', id: 'cozy' })
    expect(toCanonical('upscale')).toEqual({ group: 'atmosphere', id: 'elegant' })
    expect(GOOD_FOR.work.synonyms.en).toEqual(expect.arrayContaining(['remote workers', 'laptop', 'work from']))
    // Patrimonio Café: "funciona como cowork".
    expect(toCanonical('cowork')).toEqual({ group: 'goodFor', id: 'work' })
    expect(toCanonical('coworking')).toEqual({ group: 'goodFor', id: 'work' })
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
