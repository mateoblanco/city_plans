import { describe, expect, it } from 'vitest'
import { NEIGHBORHOOD_NAMES } from '@shared/neighborhood-names.ts'
import { resolveNeighborhood } from '@shared/neighborhood-aliases.ts'
import centroids from '@shared/neighborhood-centroids.json'
import { interpretWithDictionary } from './dictionary'
import { dishTarget } from './dishes'
import { applyRemove, classifyTerm, parseRemove, validateInterpretation } from './interpretation'
import { normalizeQuery } from './normalize'
import { llmOutput } from './test/fixtures'

describe('normalizeQuery', () => {
  it('pasa a minúscula, saca acentos y signos y corta en 200 caracteres', () => {
    expect(normalizeQuery('  ¡Cafés   en POCITOS!  ')).toBe('cafes en pocitos')
    expect(normalizeQuery('Milanesa napolitana, ¿dónde?')).toBe('milanesa napolitana donde')
    expect(normalizeQuery('a'.repeat(300))).toHaveLength(200)
  })
})

describe('barrios', () => {
  it('resuelve nombres, ids y alias al id del INE', () => {
    expect(resolveNeighborhood('Parque Rodó')).toBe('PARQUE RODO')
    expect(resolveNeighborhood('parque rodo')).toBe('PARQUE RODO')
    expect(resolveNeighborhood('el prado')).toBe('PRADO NUEVA SAVONA')
    expect(resolveNeighborhood('Ciudad Vieja')).toBe('CIUDAD VIEJA')
    expect(resolveNeighborhood('Bañados de Carrasco')).toBe('BAÃ‘ADOS DE CARRASCO')
    expect(resolveNeighborhood('Narnia')).toBeNull()
  })

  it('todos los alias apuntan a barrios que existen y todos tienen centro', () => {
    for (const id of Object.keys(NEIGHBORHOOD_NAMES)) expect(centroids).toHaveProperty([id])
    for (const alias of ['prado', 'rodo', 'parque batlle', 'capurro', 'maronas', 'penarol', 'villa munoz', 'old town']) {
      expect(NEIGHBORHOOD_NAMES).toHaveProperty([resolveNeighborhood(alias)!])
    }
  })
})

describe('atajo con diccionario', () => {
  it('arma la consulta estructurada sin LLM para combinaciones simples', () => {
    const result = interpretWithDictionary(normalizeQuery('cafés en pocitos'))
    expect(result?.must.categories).toEqual(['cafe'])
    expect(result?.must.neighborhoods).toEqual(['POCITOS'])
  })

  it('resuelve dieta, horario y platos', () => {
    expect(interpretWithDictionary('vegano')?.must.diet).toEqual({ vegan: true })
    expect(interpretWithDictionary('sin tacc')?.must.diet).toEqual({ glutenFree: true })
    expect(interpretWithDictionary('abierto ahora')?.must.openAt).toBe('now')
    const dish = interpretWithDictionary('milanesa napolitana en parque rodo')
    expect(dish?.dishes).toEqual([{ name: 'milanesa napolitana', relatedTags: ['milanesa'], relatedCategories: [] }])
    expect(dish?.must.neighborhoods).toEqual(['PARQUE RODO'])
    expect(interpretWithDictionary(normalizeQuery('brunch vegano con terraza en cordón el domingo'))?.must).toMatchObject({
      tags: ['brunch', 'terrace'],
      diet: { vegan: true },
      neighborhoods: ['CORDON'],
      openAt: { day: 0, time: null },
    })
  })

  it('lo subjetivo va a prefer y "cerca mío" pide ubicación', () => {
    expect(interpretWithDictionary('tranquilo')?.prefer.tags).toEqual(['quiet'])
    const near = interpretWithDictionary('cafe cerca mio')
    expect(near?.needsLocation).toBe(true)
    expect(near?.unrecognized).toEqual(['cerca mio'])
  })

  it('detecta inglés', () => {
    expect(interpretWithDictionary('cafe in pocitos')?.language).toBe('en')
    expect(interpretWithDictionary('vegan')?.language).toBe('en')
    expect(interpretWithDictionary('cafe en pocitos')?.language).toBe('es')
  })

  it('devuelve null si queda alguna palabra sin reconocer', () => {
    expect(interpretWithDictionary('lugar tranquilo para trabajar')).toBeNull()
    expect(interpretWithDictionary('algo que no sea pizza')).toBeNull()
    expect(interpretWithDictionary('la pasiva')).toBeNull()
    expect(interpretWithDictionary('en la')).toBeNull()
  })
})

describe('platos', () => {
  it('relaciona el plato con su tag y distingue los genéricos', () => {
    expect(dishTarget('milanesa napolitana')).toMatchObject({ tag: 'milanesa', generic: false })
    expect(dishTarget('milanesa')).toMatchObject({ tag: 'milanesa', generic: true })
    expect(dishTarget('pizza')).toMatchObject({ tag: 'pizza', category: 'pizzeria', generic: true })
    expect(dishTarget('bife')).toMatchObject({ tag: 'grilled_meat', category: 'grill', generic: false })
    expect(dishTarget('ceviche')).toMatchObject({ tag: null, generic: false })
  })
})

describe('validateInterpretation', () => {
  it('acepta ids, labels y sinónimos y los ubica en su grupo', () => {
    expect(classifyTerm('terrace')).toEqual({ kind: 'tag', id: 'terrace' })
    expect(classifyTerm('Terraza')).toEqual({ kind: 'tag', id: 'terrace' })
    expect(classifyTerm('cafe')).toEqual({ kind: 'category', id: 'cafe' })
    expect(classifyTerm('gluten_free')).toEqual({ kind: 'diet', key: 'glutenFree' })
    expect(classifyTerm('inventado')).toBeNull()
  })

  it('descarta ids y barrios inválidos y corrige el grupo', () => {
    const { interpretation, discarded } = validateInterpretation(
      llmOutput({
        must: {
          categories: ['cafe', 'terrace', 'spaceship'],
          tags: ['vegan', 'wifi_galactico'],
          diet: { vegan: false, vegetarian: false, glutenFree: true },
          neighborhoods: ['Pocitos', 'Atlantis'],
          price: ['low', 'gratis'],
          openAt: { now: false, day: 9, time: '21' },
        },
        exclude: { categories: [], tags: ['terrace'] },
        language: 'en',
      }),
    )
    expect(interpretation.must.categories).toEqual(['cafe'])
    expect(interpretation.must.tags).toEqual([]) // terrace quedó excluido
    expect(interpretation.exclude.tags).toEqual(['terrace'])
    expect(interpretation.must.diet).toEqual({ vegan: true, glutenFree: true })
    expect(interpretation.must.neighborhoods).toEqual(['POCITOS'])
    expect(interpretation.must.price).toEqual(['low'])
    expect(interpretation.must.openAt).toEqual({ day: null, time: '21:00' })
    expect(interpretation.language).toBe('en')
    expect(discarded).toEqual(['spaceship', 'wifi_galactico', 'Atlantis', 'gratis'])
  })

  it('valida los tags relacionados de cada plato', () => {
    const { interpretation, discarded } = validateInterpretation(
      llmOutput({ dishes: [{ name: ' Ceviche ', related: ['peruvian', 'Pescados y mariscos', 'vegan', 'nada'] }, { name: 'ceviche', related: ['restaurant'] }] }),
    )
    expect(interpretation.dishes).toEqual([{ name: 'ceviche', relatedTags: ['peruvian', 'seafood'], relatedCategories: ['restaurant'] }])
    expect(discarded).toEqual(['vegan', 'nada'])
  })

  it('marca needsLocation cuando el modelo deja "cerca mío" sin reconocer', () => {
    expect(validateInterpretation(llmOutput({ unrecognized: ['cerca mío'] })).interpretation.needsLocation).toBe(true)
    expect(validateInterpretation(llmOutput({ unrecognized: ['near me'] })).interpretation.needsLocation).toBe(true)
    expect(validateInterpretation(llmOutput({ unrecognized: ['para 15 personas'] })).interpretation.needsLocation).toBe(false)
  })
})

describe('remove', () => {
  it('parsea kind:id e ignora lo inválido', () => {
    expect(parseRemove('tag:terrace,neighborhood:POCITOS,foo:bar,sinpuntos,diet:vegan')).toEqual([
      { kind: 'tag', id: 'terrace' },
      { kind: 'neighborhood', id: 'POCITOS' },
      { kind: 'diet', id: 'vegan' },
    ])
    expect(parseRemove(null)).toEqual([])
  })

  it('saca los chips sin volver a interpretar', () => {
    const base = interpretWithDictionary(normalizeQuery('brunch vegano con terraza en cordón el domingo'))!
    const next = applyRemove(base, parseRemove('tag:terrace,neighborhood:CORDON,diet:vegan,openAt:day'))
    expect(next.must.tags).toEqual(['brunch'])
    expect(next.must.neighborhoods).toEqual([])
    expect(next.must.diet).toEqual({})
    expect(next.must.openAt).toBeNull()
    expect(base.must.tags).toEqual(['brunch', 'terrace']) // no muta el original
  })
})
