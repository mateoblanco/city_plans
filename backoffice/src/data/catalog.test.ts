import { describe, expect, it } from 'vitest'
import { FOOD_PLACE_TYPES, isFoodPlaceType } from './food-place-types'
import {
  MONTEVIDEO_NEIGHBORHOODS,
  isMontevideoNeighborhood,
} from './neighborhoods'
import { CATEGORIES, CUISINES, FEATURES, GOOD_FOR, RETIRED_TAGS, TAG_IDS, buildEmbeddingText, buildKeywordText, groupOf, tagsForFilter, toCanonical, withPartialTags, type TagDef } from './tags'

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
    expect(FEATURES.pool_table.label).toEqual({ es: 'Pool', en: 'Pool' })
    expect(FEATURES.pool_table.synonyms.es).toContain('metegol')
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

  it('cada cocina tiene sinónimos en los dos idiomas y los platos típicos no pisan otros términos', () => {
    for (const [id, definition] of Object.entries(CUISINES) as [string, TagDef][]) {
      expect(definition.synonyms.es.length, id).toBeGreaterThan(0)
      expect(definition.synonyms.en.length, id).toBeGreaterThan(0)
      for (const dish of definition.dishes?.es ?? []) {
        // Un plato es de una sola cocina y no es el nombre de ninguna (si es de otro grupo, como sushi, gana ese tag).
        const found = toCanonical(dish)
        if (found?.group === 'cuisines') expect(found, dish).toEqual({ group: 'cuisines', id, dish: true })
      }
    }
  })

  it('resuelve las cocinas y sus platos típicos sin sacarle palabras a otros tags', () => {
    expect(toCanonical('nikkei')).toEqual({ group: 'cuisines', id: 'nikkei' })
    expect(toCanonical('francesa')).toEqual({ group: 'cuisines', id: 'french' })
    expect(toCanonical('brasilero')).toEqual({ group: 'cuisines', id: 'brazilian' })
    expect(toCanonical('asiática')).toEqual({ group: 'cuisines', id: 'asian' })
    expect(toCanonical('cevichería')).toEqual({ group: 'cuisines', id: 'peruvian' })
    expect(toCanonical('tacos')).toBeNull()
    expect(toCanonical('taco')).toEqual({ group: 'cuisines', id: 'mexican', dish: true })
    expect(toCanonical('ceviche')).toEqual({ group: 'cuisines', id: 'peruvian', dish: true })
    expect(toCanonical('curry')).toEqual({ group: 'cuisines', id: 'indian', dish: true })
    expect(toCanonical('burrito')).toEqual({ group: 'foods', id: 'wraps' })
    expect(toCanonical('sushi')).toEqual({ group: 'foods', id: 'sushi' })
    expect(toCanonical('wok')).toEqual({ group: 'foods', id: 'wok' })
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
    expect(toCanonical('Pluxee')).toBeNull()
    expect(toCanonical('para llevar')).toEqual({ group: 'features', id: 'takeaway' })
    expect(toCanonical('family friendly')).toEqual({ group: 'goodFor', id: 'kids_friendly' })
    expect(toCanonical('bodegon')).toEqual({ group: 'categories', id: 'bodegon' })
    expect(toCanonical('bodegones')).toEqual({ group: 'categories', id: 'bodegon' })
    expect(toCanonical('minutas')).toEqual({ group: 'cuisines', id: 'uruguayan' })
    expect(toCanonical('tranquilo')).toEqual({ group: 'atmosphere', id: 'quiet' })
    expect(toCanonical('lively')).toEqual({ group: 'atmosphere', id: 'lively' })
    expect(toCanonical('acogedor')).toEqual({ group: 'atmosphere', id: 'cozy' })
    for (const term of ['de barrio', 'bolichito', 'boliche de barrio', 'clásico del barrio', 'bodegón de barrio']) {
      expect(toCanonical(term), term).toEqual({ group: 'atmosphere', id: 'neighborhood_spot' })
    }
    expect(toCanonical('boliche')).toBeNull()
    expect(toCanonical('bodegón')).toEqual({ group: 'categories', id: 'bodegon' })
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
    // "mesas afuera" ya no es un tag aparte: sus sinónimos son de al aire libre.
    for (const term of ['mesas en la vereda', 'vereda', 'sidewalk', 'outside tables']) expect(toCanonical(term)).toEqual({ group: 'features', id: 'outdoor' })
    expect(groupOf('sidewalk')).toBeNull()
    expect(tagsForFilter('outdoor')).toEqual(['outdoor', 'terrace', 'patio', 'rooftop'])
    expect(withPartialTags('outdoor')).toEqual(['outdoor', 'terrace', 'patio', 'rooftop'])
    expect(withPartialTags('terrace')).toEqual(['terrace'])
    for (const id of ['events', 'books', 'shop']) expect(groupOf(id)).toBe('features')
    expect(groupOf('lgbtq_friendly')).toBeNull()
    expect(TAG_IDS).not.toContain('lgbtq_friendly')
    expect(toCanonical('lgbtq')).toBeNull()
    // Segunda tanda de retirados: fuera del catálogo y en RETIRED_TAGS (la migración los saca de la base).
    for (const id of ['cider', 'medio_y_medio', 'non_alcoholic', 'dj', 'accepts_meal_vouchers', 'outlets', 'cash_only', 'dancing', 'night_club']) {
      expect(groupOf(id), id).toBeNull()
      expect(RETIRED_TAGS[id], id).toBeNull()
    }
    expect(Object.keys(CATEGORIES)).not.toContain('night_club')
    for (const term of ['sidra', 'medio y medio', 'tragos sin alcohol', 'dj', 'enchufes', 'solo efectivo', 'para bailar', 'discoteca']) expect(toCanonical(term), term).toBeNull()
    expect(toCanonical('metegol')).toEqual({ group: 'features', id: 'pool_table' })
    expect(groupOf('tapas')).toBe('foods')
    expect(toCanonical('platitos')).toEqual({ group: 'foods', id: 'tapas' })
    expect(toCanonical('small plates')).toEqual({ group: 'foods', id: 'tapas' })
    expect(toCanonical('tabla')).toEqual({ group: 'foods', id: 'picada' })
    expect(toCanonical('bazar')).toEqual({ group: 'features', id: 'shop' })
    expect(toCanonical('talleres')).toEqual({ group: 'features', id: 'events' })
    expect(toCanonical('workshops')).toEqual({ group: 'features', id: 'events' })
    expect(toCanonical('librería')).toEqual({ group: 'features', id: 'books' })
    expect(toCanonical('funciona como boliche')).toBeNull()
  })
})
