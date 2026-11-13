import { describe, expect, it } from 'vitest'
import { NEIGHBORHOOD_DISPLAY_NAMES, NEIGHBORHOOD_NAMES, neighborhoodDisplayName } from '@shared/neighborhood-names.ts'
import { neighborhoodsIn, resolveNeighborhood } from '@shared/neighborhood-aliases.ts'
import { removedWordsOf } from '../search'
import centroids from '@shared/neighborhood-centroids.json'
import { interpretWithDictionary } from '../dictionary'
import { dishTarget } from '../dishes'
import { applyRemove, classifyTerm, emptyInterpretation, parseRemove, validateInterpretation } from '../interpretation'
import { normalizeQuery } from '../normalize'
import { applyWhen } from '../when'
import { llmOutput } from './fixtures'

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

  it('el nombre para mostrar no cambia el id y los nombres viejos siguen resolviendo', () => {
    expect(neighborhoodDisplayName('PRADO NUEVA SAVONA')).toBe('Prado')
    expect(neighborhoodDisplayName('POCITOS')).toBe('Pocitos')
    for (const name of ['Prado', 'Prado Nueva Savona', 'Prado - Nueva Savona', 'Nueva Savona', 'PRADO NUEVA SAVONA']) {
      expect(resolveNeighborhood(name)).toBe('PRADO NUEVA SAVONA')
    }
    expect([...neighborhoodsIn('pizza en prado nueva savona')]).toEqual(['PRADO NUEVA SAVONA'])
    for (const id of Object.keys(NEIGHBORHOOD_DISPLAY_NAMES)) expect(NEIGHBORHOOD_NAMES).toHaveProperty([id])
  })

  it('quitar el chip de un barrio renombrado saca también las palabras del nombre viejo', () => {
    expect([...removedWordsOf([{ kind: 'neighborhood', id: 'PRADO NUEVA SAVONA' }])].sort()).toEqual(['nueva', 'prado', 'savona'])
  })

  it('todos los alias apuntan a barrios que existen y todos tienen centro', () => {
    for (const id of Object.keys(NEIGHBORHOOD_NAMES)) expect(centroids).toHaveProperty([id])
    for (const alias of ['prado', 'rodo', 'parque batlle', 'capurro', 'maronas', 'penarol', 'villa munoz', 'old town']) {
      expect(NEIGHBORHOOD_NAMES).toHaveProperty([resolveNeighborhood(alias)!])
    }
  })
})

describe('horario del texto', () => {
  it('"tarde" con bares es trasnoche: late_night y 23:30 del día pedido (o de hoy)', () => {
    const martes = interpretWithDictionary('tomar algo tarde un martes')
    expect(martes?.intent).toBe('bars')
    expect(martes?.prefer.tags).toContain('late_night')
    expect(martes?.must.openAt).toEqual({ day: 2, time: '23:30' })
    const hoy = interpretWithDictionary('salir tarde hoy')
    expect(hoy?.intent).toBe('bars')
    expect(hoy?.prefer.tags).toContain('late_night')
    expect(hoy?.must.openAt).toEqual({ day: null, time: '23:30' })
    expect(interpretWithDictionary('unos tragos tarde esta noche')?.must.openAt).toEqual({ day: null, time: '23:30' })
  })

  it('las franjas: a la tarde 17:00, a la noche 21:00; "esta noche" y "hoy" como siempre', () => {
    const merienda = interpretWithDictionary('merendar a la tarde')
    expect(merienda?.must.tags).toEqual(['afternoon_snack'])
    expect(merienda?.must.openAt).toEqual({ day: null, time: '17:00' })
    expect(merienda?.prefer.tags).not.toContain('late_night')
    expect(interpretWithDictionary('cafe por la tarde el domingo')?.must.openAt).toEqual({ day: 0, time: '17:00' })
    expect(interpretWithDictionary('cena el viernes a la noche')?.must.openAt).toEqual({ day: 5, time: '21:00' })
    expect(interpretWithDictionary('tomar algo esta noche')?.must.openAt).toBe('tonight')
    expect(interpretWithDictionary('cenar hoy')?.must.openAt).toBe('today')
  })

  it('"tarde" sin bares y "salir" sin noche no se fuerzan: va al modelo', () => {
    expect(interpretWithDictionary('comer tarde')).toBeNull()
    expect(interpretWithDictionary('salir en pareja')).toBeNull()
    // "abierto hasta tarde" es la frase del catálogo (late_night), no "abierto" + "tarde".
    expect(interpretWithDictionary('bar abierto hasta tarde')?.must.openAt).toBeNull()
  })

  it('sobre lo que dijo el modelo: lo escrito manda', () => {
    const fromLlm = { ...emptyInterpretation(), intent: 'bars' as const, must: { ...emptyInterpretation().must, openAt: { day: 2, time: '21:00' } } }
    const result = applyWhen(fromLlm, 'tomar algo tarde un martes')
    expect(result.must.openAt).toEqual({ day: 2, time: '23:30' })
    expect(result.prefer.tags).toEqual(['late_night'])
    // Sin horario en el texto, queda lo del modelo (la hora concreta, "a las 22").
    const hour = { ...fromLlm, must: { ...fromLlm.must, openAt: { day: null, time: '22:00' } } }
    expect(applyWhen(hour, 'bar a las 22').must.openAt).toEqual({ day: null, time: '22:00' })
    expect(applyWhen(hour, 'bar el viernes a las 22').must.openAt).toEqual({ day: 5, time: '22:00' })
  })
})

describe('atajo con diccionario', () => {
  it('arma la consulta estructurada sin LLM para combinaciones simples', () => {
    const result = interpretWithDictionary(normalizeQuery('cafés en pocitos'))
    expect(result?.must.categories).toEqual(['cafe'])
    expect(result?.must.neighborhoods).toEqual(['POCITOS'])
  })

  it('platos genéricos sin tag propio: "comer carne" no pasa por el modelo', () => {
    const carne = interpretWithDictionary('comer carne')
    expect(carne?.dishes).toEqual([{ name: 'carne', relatedTags: ['grilled_meat'], relatedCategories: ['grill'] }])
    expect(carne?.intent).toBe('eat')
    expect(carne?.must.tags).toEqual([])
    expect(interpretWithDictionary('carnes en pocitos')?.dishes).toEqual([{ name: 'carnes', relatedTags: ['grilled_meat'], relatedCategories: ['grill'] }])
    expect(interpretWithDictionary('meat')?.language).toBe('en')
    // "sin carne" es exclude de la carne, no filtro vegetariano (la frase más larga gana sobre "carne" y la negación).
    expect(interpretWithDictionary('sin carne')?.must.diet).toEqual({})
    expect(interpretWithDictionary('sin carne')?.exclude.tags).toEqual(['grilled_meat'])
    expect(interpretWithDictionary('sin carne')?.dishes).toEqual([])
    // pescado, mariscos y pollo ya estaban: son sinónimos de seafood y chicken.
    expect(interpretWithDictionary('comer pescado')?.dishes).toEqual([{ name: 'pescado', relatedTags: ['seafood'], relatedCategories: [] }])
    expect(interpretWithDictionary('mariscos')?.dishes).toEqual([{ name: 'mariscos', relatedTags: ['seafood'], relatedCategories: [] }])
    expect(interpretWithDictionary('comer pollo')?.dishes).toEqual([{ name: 'pollo', relatedTags: ['chicken'], relatedCategories: [] }])
  })

  it('resuelve dieta, horario y platos', () => {
    expect(interpretWithDictionary('vegano')?.must.diet).toEqual({ vegan: true })
    expect(interpretWithDictionary('sin tacc')?.must.diet).toEqual({ glutenFree: true })
    expect(interpretWithDictionary('abierto ahora')?.must.openAt).toBe('today')
    expect(interpretWithDictionary('cenar hoy')?.must.openAt).toBe('today')
    expect(interpretWithDictionary('tomar algo esta noche')?.must.openAt).toBe('tonight')
    expect(interpretWithDictionary('cenar el sabado')?.must.openAt).toEqual({ day: 6, time: null })
    const dish = interpretWithDictionary('milanesa napolitana en parque rodo')
    expect(dish?.dishes).toEqual([{ name: 'milanesa napolitana', relatedTags: ['milanesa'], relatedCategories: [] }])
    expect(dish?.must.neighborhoods).toEqual(['PARQUE RODO'])
    // Un plato típico de una cocina va como plato con la cocina de respaldo, no como filtro de cocina.
    const tacos = interpretWithDictionary('tacos en cordon')
    expect(tacos?.dishes).toEqual([{ name: 'tacos', relatedTags: ['mexican'], relatedCategories: [] }])
    expect(tacos?.must.tags).toEqual([])
    expect(interpretWithDictionary('comida mexicana')?.must.tags).toEqual(['mexican'])
    expect(interpretWithDictionary('nikkei')?.must.tags).toEqual(['nikkei'])
    expect(interpretWithDictionary('comida rusa')?.must.tags).toEqual(['russian'])
    expect(interpretWithDictionary('pelmeni')?.dishes).toEqual([{ name: 'pelmeni', relatedTags: ['russian'], relatedCategories: [] }])
    // La ensalada rusa es una ensalada, no la cocina rusa.
    expect(interpretWithDictionary('ensalada rusa')?.must.tags).not.toContain('russian')
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

  it('"mejor", "best" y "top" piden lo mejor sin ser filtro', () => {
    const best = interpretWithDictionary(normalizeQuery('los mejores cafés'))
    expect(best).toMatchObject({ wantsBest: true, must: { categories: ['cafe'] }, unrecognized: [] })
    expect(interpretWithDictionary('best cafe')).toMatchObject({ wantsBest: true, language: 'en' })
    expect(interpretWithDictionary('top bares')?.wantsBest).toBe(true)
    expect(interpretWithDictionary('cafes en pocitos')?.wantsBest).toBe(false)
    expect(interpretWithDictionary('el mejor')).toBeNull()
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
    // "comer carne": una parrilla es conocida por la carne (knownFor), aunque "carne" no sea un tag.
    expect(dishTarget('carne')).toMatchObject({ tag: null, icons: ['grill', 'meat'] })
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
    expect(classifyTerm('tacos')).toBeNull()
    expect(classifyTerm('Mexicana')).toEqual({ kind: 'tag', id: 'mexican' })
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
          openAt: { today: false, tonight: false, day: 9, time: '21' },
        },
        exclude: { categories: [], tags: ['terrace'] },
        language: 'en',
      }),
      'gluten free cafe in pocitos',
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
      '',
    )
    expect(interpretation.dishes).toEqual([{ name: 'ceviche', relatedTags: ['peruvian', 'seafood'], relatedCategories: ['restaurant'] }])
    expect(discarded).toEqual(['vegan', 'nada'])
  })

  it('marca needsLocation cuando el modelo deja "cerca mío" sin reconocer', () => {
    expect(validateInterpretation(llmOutput({ unrecognized: ['cerca mío'] }), '').interpretation.needsLocation).toBe(true)
    expect(validateInterpretation(llmOutput({ unrecognized: ['near me'] }), '').interpretation.needsLocation).toBe(true)
    expect(validateInterpretation(llmOutput({ unrecognized: ['para 15 personas'] }), '').interpretation.needsLocation).toBe(false)
    const best = validateInterpretation(llmOutput({ wantsBest: true, unrecognized: ['el mejor', 'the best', 'cerca mío'] }), '').interpretation
    expect(best.wantsBest).toBe(true)
    expect(best.unrecognized).toEqual(['cerca mío'])
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

describe('tenedor libre, horno a leña y azotea', () => {
  const read = (query: string) => interpretWithDictionary(normalizeQuery(query))

  it('"tenedor libre", "buffet" y "X libre" piden all_you_can_eat', () => {
    expect(read('tenedor libre')?.must.tags).toEqual(['all_you_can_eat'])
    expect(read('buffet en pocitos')?.must.tags).toEqual(['all_you_can_eat'])
    expect(read('buffet')?.language).toBe('es')
    expect(read('comer libre')?.must.tags).toEqual(['all_you_can_eat'])
    const sushi = read('sushi libre')
    expect(sushi?.must.tags).toEqual(['all_you_can_eat'])
    expect(sushi?.dishes.map((dish) => dish.name)).toEqual(['sushi'])
    expect(read('parrilla libre')?.must.tags).toContain('all_you_can_eat')
  })

  it('"libre" fuera de comida no es tenedor libre', () => {
    expect(read('al aire libre')?.must.tags ?? []).not.toContain('all_you_can_eat')
    expect(read('al aire libre')?.must.tags).toEqual(['outdoor'])
    expect(read('barra libre')).toBeNull()
    expect(interpretWithDictionary('libre de gluten', { partial: true })!.must.tags).toEqual([])
  })

  it('"pizza a la leña" pide la pizza y el horno a leña; azotea es rooftop, no terrace', () => {
    const pizza = read('pizza a la leña')
    expect(pizza?.must.tags).toEqual(['wood_fired_oven'])
    expect(pizza?.dishes.map((dish) => dish.name)).toEqual(['pizza'])
    expect(read('horno a leña')?.must.tags).toEqual(['wood_fired_oven'])
    expect(read('pizzas a la leña')?.must.tags).toEqual(['wood_fired_oven'])
    // "a la leña" suelto ya no es un sinónimo: una parrilla a la leña no pide horno.
    expect(interpretWithDictionary(normalizeQuery('parrilla a la leña'), { partial: true })!.must.tags).not.toContain('wood_fired_oven')
    expect(read('azotea')?.must.tags).toEqual(['rooftop'])
    expect(read('rooftop')?.must.tags).toEqual(['rooftop'])
    expect(read('terraza')?.must.tags).toEqual(['terrace'])
    expect(read('merienda para compartir')?.must.tags).toEqual(['shared_afternoon_tea'])
  })
})

describe('diccionario parcial (respaldo sin modelo)', () => {
  it('toma lo reconocido, ignora lo desconocido y lo que sigue a una negación', () => {
    const value = interpretWithDictionary('algo tranqui con terraza en cordon que no sea pizza', { partial: true })!
    expect(value.must.neighborhoods).toEqual(['CORDON'])
    expect(value.dishes).toEqual([])
    expect(interpretWithDictionary('algo tranqui con terraza en cordon', { partial: false })).toBeNull()
  })

  it('"sin tacc" sigue siendo dieta, no una negación', () => {
    expect(interpretWithDictionary('algo rico sin tacc', { partial: true })!.must.diet).toEqual({ glutenFree: true })
  })

  it('sin nada reconocido devuelve una interpretación vacía, no null', () => {
    expect(interpretWithDictionary('lugar raro', { partial: true })!.must).toMatchObject({ categories: [], tags: [], neighborhoods: [] })
  })
})
