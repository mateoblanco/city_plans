import { describe, expect, it } from 'vitest'
import { guideStyle } from './prompts.ts'
import { dishIssues, forbiddenPhrases, introIssues, openingIssues, phraseIssues, standalonePriceIssues, themeIssues } from './style-checks.ts'

describe('muletillas prohibidas', () => {
  it('se leen de la guía de estilo (la sección "Muletillas prohibidas"), sin comillas ni tildes', () => {
    const phrases = forbiddenPhrases(guideStyle())
    expect(phrases).toEqual(expect.arrayContaining(['sin formalidades', 'para compartir', 'ideal para']))
    expect(phrases.length).toBeGreaterThan(5)
    expect(forbiddenPhrases('# Sin sección')).toEqual([])
  })

  it('rechaza el texto que usa alguna, por palabra completa', () => {
    const phrases = ['sin formalidades', 'para compartir']
    expect(phraseIssues('Un patio para una charla sin formalidades.', phrases)).toEqual(['muletillas prohibidas ("sin formalidades")'])
    expect(phraseIssues('Picadas para compartir.', phrases)).toHaveLength(1)
    expect(phraseIssues('Picadas para compartirlas.', phrases)).toEqual([])
  })
})

describe('tema de la guía repetido', () => {
  it('dos palabras seguidas del gancho del título (o de la idea) en el texto de un lugar', () => {
    const themes = ['Primera cita sin ceremonia: bares y restaurantes para charlar tranquilos', 'bares para una primera cita']
    expect(themeIssues('Un patio tranquilo, bueno para una primera cita.', themes)).toHaveLength(1)
    expect(themeIssues('Cervecería con patio y cerveza propia de tirada.', themes)).toEqual([])
    // Lo de después de los dos puntos no cuenta ("charlar tranquilos" es la descripción, no el tema).
    expect(themeIssues('Mesas chicas para charlar tranquilos.', ['Primera cita sin ceremonia: bares y restaurantes para charlar tranquilos'])).toEqual([])
  })
})

describe('arranques, platos y precio', () => {
  it('el mismo arranque (3 primeras palabras) que otro texto de la guía', () => {
    const others = ['Cervecería artesanal con cerveza propia.']
    expect(openingIssues('Cervecería artesanal con patio y cócteles.', others)).toHaveLength(1)
    expect(openingIssues('Cervecería de barrio con patio.', others)).toEqual([])
  })

  it('más de 2 platos de los datos: está enumerando la carta', () => {
    const dishes = ['pizza', 'faina', 'empanadas', 'milanesitas de lomo', 'hummus con grisines']
    expect(dishIssues('Para picar hay pizza, faina, empanadas y milanesitas de lomo.', dishes)).toEqual(['más de 2 platos (pizza, faina, empanadas, milanesitas de lomo)'])
    expect(dishIssues('Buenas empanadas y una pizza al horno de barro.', dishes)).toEqual([])
  })

  it('singular y plural, y un plato dentro de otro, cuentan una vez', () => {
    expect(dishIssues('Tacos de bondiola y chivitos; el chivito es el clásico.', ['tacos de bondiola', 'chivito', 'chivitos'])).toEqual([])
    expect(dishIssues('Shawarma de pollo al carbón y cheesecake.', ['shawarma de pollo', 'pollo', 'cheesecake'])).toEqual([])
  })

  it('el precio como frase suelta, no integrado', () => {
    expect(standalonePriceIssues('Cervecería con patio. Es caro.')).toHaveLength(1)
    expect(standalonePriceIssues('Cervecería con patio. Precio medio.')).toHaveLength(1)
    expect(standalonePriceIssues('Un bodegón económico con milanesas al pan.')).toEqual([])
  })
})

describe('introducción', () => {
  it('sin nombres de lugares de la guía ni una lista de barrios (uno se tolera)', () => {
    const names = ['Matute', 'Birra Brava']
    expect(introIssues('Para una primera charla, Matute y otros bares tranquilos.', names)).toEqual(['nombres de lugares (Matute)'])
    expect(introIssues('Bares tranquilos de Pocitos, Cordón y Ciudad Vieja.', names)).toEqual([expect.stringMatching(/^una lista de barrios/)])
    expect(introIssues('Bares tranquilos de Cordón para conversar sin apuro.', names)).toEqual([])
  })
})
