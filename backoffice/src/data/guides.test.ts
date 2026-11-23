import { describe, expect, it } from 'vitest'
import {
  MIN_GUIDE_PLACES,
  guideNeighborhoodPath,
  guideUrlPath,
  introParagraphs,
  isGuideSlug,
  publishIssues,
  seoDescriptionFromIntro,
  slugClashesWithNeighborhood,
  slugIssues,
  type GuideDraftInput,
} from './guides'
import { NEIGHBORHOOD_NAMES } from './neighborhood-names'

const place = (n: number, published = true) => ({ placeId: `00000000-0000-4000-8000-00000000000${n}`, text: `Texto ${n}`, published })

const complete = (overrides: Partial<GuideDraftInput> = {}): GuideDraftInput => ({
  slug: 'cafes-donde-nadie-te-apura',
  group: 'cafes',
  title: 'Cafés donde nadie te apura',
  seoTitle: 'Cafés para trabajar en Cordón',
  seoDescription: 'Nueve cafés de Cordón.',
  intro: 'Cordón está lleno de cafés.',
  places: [1, 2, 3, 4].map((n) => place(n)),
  ...overrides,
})

describe('URL de una guía', () => {
  it('plana: /guides/<ciudad>/<slug>, sin el barrio', () => {
    expect(guideUrlPath({ city: 'montevideo', slug: 'cafes-donde-nadie-te-apura' })).toBe('/guides/montevideo/cafes-donde-nadie-te-apura')
    expect(guideNeighborhoodPath('montevideo', 'CORDON')).toBe('/guides/montevideo/cordon')
  })
})

describe('slug de guía', () => {
  it('acepta minúsculas, números y guiones sueltos; rechaza el resto', () => {
    expect(isGuideSlug('cafes-donde-nadie-te-apura')).toBe(true)
    expect(isGuideSlug('top-10')).toBe(true)
    for (const bad of ['Cafes', 'cafés', 'cafes--x', '-cafes', 'cafes-', 'ca', 'a b', 'x'.repeat(81)]) expect(isGuideSlug(bad)).toBe(false)
  })

  it('choca con cualquier barrio (tenga guías o no), con el tramo de la URL', () => {
    for (const id of Object.keys(NEIGHBORHOOD_NAMES)) {
      const slug = guideNeighborhoodPath('montevideo', id).split('/')[3]
      expect(slugClashesWithNeighborhood(slug)).toBe(true)
    }
    expect(slugClashesWithNeighborhood('pocitos')).toBe(true)
    expect(slugClashesWithNeighborhood('ciudad-vieja')).toBe(true)
    expect(slugClashesWithNeighborhood('sushi-para-una-cita')).toBe(false)
    expect(slugIssues('cordon')).toEqual([expect.objectContaining({ code: 'slug_neighborhood' })])
    expect(slugIssues('Cordón')).toEqual([expect.objectContaining({ code: 'slug_invalid' })])
  })
})

describe('publishIssues', () => {
  it('una guía completa con el mínimo de lugares se puede publicar', () => {
    expect(publishIssues(complete())).toEqual([])
  })

  it(`pide ${MIN_GUIDE_PLACES} lugares publicados: uno despublicado no cuenta`, () => {
    expect(publishIssues(complete({ places: [1, 2, 3].map((n) => place(n)) }))).toEqual([expect.objectContaining({ code: 'min_places' })])
    expect(publishIssues(complete({ places: [place(1), place(2), place(3), place(4, false)] }))).toEqual([expect.objectContaining({ code: 'min_places' })])
  })

  it('lista los obligatorios vacíos, el texto de un lugar y el slug', () => {
    const codes = publishIssues(complete({ title: ' ', intro: '', places: [place(1), place(2), place(3), { ...place(4), text: '' }], slug: 'pocitos' })).map(
      (issue) => (issue.code === 'required' ? `required:${issue.field}` : issue.code),
    )
    expect(codes).toEqual(['required:title', 'required:intro', 'slug_neighborhood', 'place_text'])
  })
})

describe('introducción y descripción para Google', () => {
  it('párrafos separados por línea en blanco', () => {
    expect(introParagraphs('Uno\nsigue.\n\n  Dos.  \n\n\n')).toEqual(['Uno sigue.', 'Dos.'])
    expect(introParagraphs(null)).toEqual([])
  })

  it('entera si entra; si no, en la última oración o la última palabra, sin pasarse', () => {
    expect(seoDescriptionFromIntro('Corta.')).toBe('Corta.')
    expect(seoDescriptionFromIntro('')).toBeNull()
    const sentences = `${'Primera oración bastante larga para ocupar más de la mitad del lugar de la descripción de Google'}. ${'Segunda que ya no entra porque se pasa del largo máximo permitido por mucho margen'}.`
    expect(seoDescriptionFromIntro(sentences)).toBe('Primera oración bastante larga para ocupar más de la mitad del lugar de la descripción de Google.')
    const words = 'palabra '.repeat(40).trim()
    const cut = seoDescriptionFromIntro(words)!
    expect(cut.length).toBeLessThanOrEqual(155)
    expect(cut.endsWith('palabra…')).toBe(true)
  })
})

describe('slug desde el título (sin IA)', () => {
  it('minúsculas, sin tildes, ñ → n, guiones', async () => {
    const { slugify } = await import('./guides')
    expect(slugify('Cafés con ñandú en Peñarol')).toBe('cafes-con-nandu-en-penarol')
    expect(slugify('  ¿Dónde tomar algo? ¡Bares & más!  ')).toBe('donde-tomar-algo-bares-mas')
    expect(slugify('Pingüinos: año 2026')).toBe('pinguinos-ano-2026')
    const long = slugify('palabra '.repeat(20))
    expect(long.length).toBeLessThanOrEqual(80)
    expect(long.endsWith('-')).toBe(false)
  })
})
