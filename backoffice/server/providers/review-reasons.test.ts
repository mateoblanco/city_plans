import { describe, expect, it } from 'vitest'
import type { PlaceReview } from '../../src/types/places.ts'
import { instagramActivity, instagramOperating, reviewReasonsFor, soundsNotOpenYet } from './review-reasons.ts'

const fact = (text: string) => ({ id: 'F1', text, kind: 'other' as const, sourceId: 'S1', sourceUrl: 'https://lugar.example/', trust: 'official' as const, supports: [] })
const review = (overrides: Partial<Pick<PlaceReview, 'doubts' | 'anomalies'>> = {}) => ({ doubts: [], anomalies: [], ...overrides })
const OPEN = [fact('Abre de lunes a viernes de 9 a 18')]

describe('reviewReasonsFor', () => {
  it('VÜS Café: el sitio dice próximamente (fact y duda del modelo)', () => {
    const place = { placeFacts: [fact('VÜS CAFE es un café que abrirá pronto; el sitio dice próximamente'), fact('El nombre de la marca es VÜS CAFE')] }
    expect(reviewReasonsFor(place, review({ doubts: ['El local figura como próximamente; no hay horarios, carta ni dirección en fuentes confiables.'] }))).toEqual(['not_open_yet'])
    // Alcanza con la duda que el prompt pide anotar.
    expect(reviewReasonsFor({ placeFacts: OPEN }, review({ doubts: ['Todavía no abrió: la web anuncia la apertura'] }))).toEqual(['not_open_yet'])
  })

  it('reconoce las frases de un local por abrir, sin acentos ni mayúsculas', () => {
    for (const text of ['PROXIMAMENTE en Pocitos', 'Abrimos muy pronto', 'Pronto abrimos nuestro local', 'Abrirá sus puertas en noviembre', 'Próxima apertura: diciembre', 'Estamos por abrir', 'Coming soon', 'Aún no abrió al público']) {
      expect(soundsNotOpenYet(text), text).toBe(true)
    }
  })

  it('no confunde un local abierto que habla de su apertura u horarios', () => {
    for (const text of ['Horario de apertura: 9 h', 'Desde su apertura en 2015 es un clásico', 'Gran apertura de la terraza', 'Abre a las 8', 'El local abrirá a las 19 los sábados']) {
      expect(soundsNotOpenYet(text), text).toBe(false)
    }
    expect(reviewReasonsFor({ placeFacts: OPEN }, review())).toEqual([])
  })

  it('Ébano: sin ningún fact del local porque todas las fuentes eran de otros lugares', () => {
    const doubts = ['Ninguna fuente corresponde al local Ébano de Bv. España 2288, Montevideo.', 'Se descartaron todos los hechos por ser de otros locales, ciudades y países.']
    expect(reviewReasonsFor({ placeFacts: [] }, review({ doubts }))).toEqual(['no_place_facts'])
  })

  it('restaurant_without_food y bar_without_drinks mandan a revisión; cuisine_unmentioned y el resto, no', () => {
    const anomalies: PlaceReview['anomalies'] = [
      { type: 'restaurant_without_food', detail: 'restaurant' },
      { type: 'bar_without_drinks', detail: 'bar' },
      { type: 'cuisine_unmentioned', detail: 'peruvian' },
      { type: 'hours_vague', detail: 'none' },
      { type: 'no_contact', detail: 'sin instagram ni website' },
    ]
    expect(reviewReasonsFor({ placeFacts: OPEN }, review({ anomalies }))).toEqual(['restaurant_without_food', 'bar_without_drinks'])
    expect(reviewReasonsFor({ placeFacts: OPEN }, review({ anomalies: anomalies.slice(2) }))).toEqual([])
  })
})

describe('Instagram oficial activo', () => {
  const now = new Date('2026-10-19T12:00:00.000Z')
  // Del snapshot de Café Paraíso: la web dice "Muy pronto en Montevideo", Instagram lo muestra funcionando.
  const paraiso = {
    placeFacts: [fact('La web oficial dice que Café Paraíso abre muy pronto en Montevideo'), fact('Abre de lunes a sábados de 9:00 a 20:00')],
  }
  const paraisoDoubts = review({ doubts: ['Todavía no abrió: la web oficial dice «Muy pronto en Montevideo», aunque Instagram y terceros muestran el local en funcionamiento.'] })

  it('Café Paraíso: con el Instagram funcionando no va a not_open_yet; sin Instagram, sí', () => {
    const activity = instagramActivity({ bio: 'Lunes a Sábados | 9:00 a 20:00\nNo tomamos reservas\nConstituyente 1866' })
    expect(activity).toEqual({ latestPostAt: null, bioHasHours: true, notOpenYet: false })
    expect(reviewReasonsFor(paraiso, paraisoDoubts, { instagramOperating: instagramOperating(activity, now) })).toEqual([])
    expect(reviewReasonsFor(paraiso, paraisoDoubts)).toEqual(['not_open_yet'])
  })

  it('Jackson Bar: un cierre que informa Apple Maps no lo manda a revisión', () => {
    const jackson = review({ doubts: ['Apple Maps lo marca como cerrado permanentemente, pero el Instagram oficial muestra actividad reciente.'] })
    expect(reviewReasonsFor({ placeFacts: OPEN }, jackson)).toEqual([])
    expect(instagramOperating(instagramActivity({ bio: 'El clásico de Jueves, viernes y sábados 🪩\nAbrimos 22 hs.' }), now)).toBe(true)
  })

  it('cuenta como activo con un post de los últimos 60 días aunque la bio no tenga horarios', () => {
    const activity = (latestPostAt: string) => instagramActivity({ bio: 'Café de especialidad', latestPostAt })
    expect(instagramOperating(activity('2026-09-01T12:00:00.000Z'), now)).toBe(true)
    expect(instagramOperating(activity('2026-07-01T12:00:00.000Z'), now)).toBe(false)
    expect(instagramOperating(null, now)).toBe(false)
  })

  it('un Instagram que dice próximamente (bio o último post) no cuenta como funcionando', () => {
    const teaser = instagramActivity({ bio: 'Próximamente en Cordón · 9:00 a 18:00', latestPostAt: '2026-10-18T12:00:00.000Z' })
    expect(teaser.notOpenYet).toBe(true)
    expect(instagramOperating(teaser, now)).toBe(false)
    const post = instagramActivity({ bio: 'Café', posts: ['¡Abrimos muy pronto!', 'Obra en marcha'], latestPostAt: '2026-10-18T12:00:00.000Z' })
    expect(instagramOperating(post, now)).toBe(false)
    expect(reviewReasonsFor(paraiso, paraisoDoubts, { instagramOperating: instagramOperating(teaser, now) })).toEqual(['not_open_yet'])
  })

  it('no toma direcciones ni números sueltos como horario', () => {
    expect(instagramActivity({ bio: 'Constituyente 1866 · Cordón' }).bioHasHours).toBe(false)
    expect(instagramActivity({ bio: '+1.500 seguidores felices' }).bioHasHours).toBe(false)
  })
})
