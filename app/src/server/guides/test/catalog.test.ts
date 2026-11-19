import { describe, expect, it } from 'vitest'
import { INTENTS } from '@shared/intents.ts'
import { NEIGHBORHOOD_NAMES } from '@shared/neighborhood-names.ts'
import {
  cityGuideParams,
  citySlugClashes,
  findCityGuide,
  findGuide,
  GUIDE_CITY,
  GUIDE_NEIGHBORHOODS,
  GUIDES,
  guideBreadcrumb,
  guideParams,
  guidePath,
  neighborhoodBreadcrumb,
  neighborhoodGuides,
  neighborhoodParams,
  neighborhoodPath,
  neighborhoodSlug,
  resolveCitySegment,
  visibleGuides,
} from '../catalog'
import { guideSitemapPages } from '../sitemap'
import type { Guide } from '../types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const production = { NODE_ENV: 'production' }
const development = { NODE_ENV: 'development' }

describe('el contenido de cada guía', () => {
  for (const guide of GUIDES) {
    describe(guide.slug, () => {
      it('slug, barrio (si tiene), grupo y fecha válidos', () => {
        expect(guide.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
        // También es la fila (origin_row) de los eventos de popularidad: ORIGIN_ROW_PATTERN, hasta 40.
        expect(guide.slug.length).toBeLessThanOrEqual(40)
        if (guide.neighborhood) expect(NEIGHBORHOOD_NAMES).toHaveProperty(guide.neighborhood)
        expect(Object.keys(INTENTS)).toContain(guide.group)
        expect(guide.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(new Date(`${guide.updatedAt}T00:00:00Z`).toISOString().slice(0, 10)).toBe(guide.updatedAt)
      })

      it('textos para Google con largo razonable', () => {
        expect(guide.seoTitle.length).toBeLessThanOrEqual(70)
        expect(guide.seoDescription.length).toBeLessThanOrEqual(160)
        expect(guide.intro.length).toBeGreaterThan(0)
      })

      it('lugares: ids de la base, sin repetir, con texto de 2–3 líneas', () => {
        expect(guide.places.length).toBeGreaterThan(0)
        const ids = guide.places.map((place) => place.id)
        expect(new Set(ids).size).toBe(ids.length)
        for (const place of guide.places) {
          expect(place.id).toMatch(UUID)
          expect(place.text.trim().length).toBeGreaterThan(40)
          expect(place.text.length).toBeLessThanOrEqual(320)
        }
      })
    })
  }

  it('cada barrio del config existe y tiene textos para Google con largo razonable; la ciudad también', () => {
    for (const entry of [...GUIDE_NEIGHBORHOODS, GUIDE_CITY]) {
      if ('neighborhood' in entry) expect(NEIGHBORHOOD_NAMES).toHaveProperty(entry.neighborhood)
      expect(entry.intro.length).toBeGreaterThan(0)
      expect(entry.seoTitle.length).toBeLessThanOrEqual(70)
      expect(entry.seoDescription.length).toBeLessThanOrEqual(160)
    }
  })

  it('no hay dos guías con la misma URL', () => {
    const paths = GUIDES.map(guidePath)
    expect(new Set(paths).size).toBe(paths.length)
  })
})

describe('guías de toda la ciudad', () => {
  it('ningún slug de una guía de ciudad coincide con el de un barrio (todos los barrios, tengan guías o no)', () => {
    expect(citySlugClashes(GUIDES)).toEqual([])
  })

  it('el chequeo de choque detecta uno: una guía de ciudad "pocitos" o "ciudad-vieja" (barrios sin guías hoy)', () => {
    const clash = (slug: string) => ({ ...GUIDES[0], neighborhood: undefined, slug }) as Guide
    expect(citySlugClashes([clash('pocitos'), clash('ciudad-vieja'), clash('sushi')])).toEqual(['pocitos', 'ciudad-vieja'])
  })

  it('URL sin barrio: /guides/montevideo/<slug>', () => {
    const guide = findCityGuide('sushi-para-una-cita', visibleGuides(development))
    expect(guide && guidePath(guide)).toBe('/guides/montevideo/sushi-para-una-cita')
  })

  it('la ruta resuelve primero el barrio y después la guía de ciudad', () => {
    const cityGuide = { ...GUIDES[0], neighborhood: undefined, slug: 'cordon', draft: false } as Guide
    const guides = [...visibleGuides(production), cityGuide]
    expect(resolveCitySegment('cordon', guides)).toEqual({ kind: 'neighborhood' })
    expect(resolveCitySegment('sushi-para-una-cita', visibleGuides(development))).toMatchObject({ kind: 'guide' })
    expect(resolveCitySegment('pocitos', visibleGuides(production))).toBeNull()
    expect(resolveCitySegment('xyz')).toBeNull()
  })

  it('una guía de ciudad no se encuentra como guía de barrio, ni al revés', () => {
    const visible = visibleGuides(development)
    expect(findGuide('montevideo', 'sushi-para-una-cita', visible)).toBeNull()
    expect(findCityGuide('cafes-donde-nadie-te-apura', visible)).toBeNull()
  })
})

describe('URLs y params', () => {
  it('el barrio va sin tildes ni mayúsculas, con guiones', () => {
    expect(neighborhoodSlug('CORDON')).toBe('cordon')
    expect(neighborhoodSlug('CIUDAD VIEJA')).toBe('ciudad-vieja')
    expect(neighborhoodSlug('PRADO NUEVA SAVONA')).toBe('prado')
    expect(neighborhoodPath('montevideo', 'CORDON')).toBe('/guides/montevideo/cordon')
  })

  it('en producción: la guía publicada y su barrio; ninguna guía de ciudad', () => {
    const visible = visibleGuides(production)
    const guide = findGuide('cordon', 'cafes-donde-nadie-te-apura', visible)
    expect(guide && guidePath(guide)).toBe('/guides/montevideo/cordon/cafes-donde-nadie-te-apura')
    expect(guideParams(visible)).toEqual([{ segment: 'cordon', slug: 'cafes-donde-nadie-te-apura' }])
    expect(neighborhoodParams(visible)).toEqual([{ segment: 'cordon' }])
    expect(cityGuideParams(visible)).toEqual([])
  })

  it('un barrio sin guías no tiene página (ni params)', () => {
    expect(neighborhoodGuides('pocitos', visibleGuides(production))).toEqual([])
    expect(neighborhoodGuides('xyz')).toEqual([])
  })
})

describe('borradores', () => {
  const drafts = GUIDES.filter((guide) => guide.draft)

  it('incluyen una guía de ciudad (sushi) y una de otro barrio (Pocitos)', () => {
    expect(drafts.map((guide) => guide.slug)).toEqual(expect.arrayContaining(['sushi-para-una-cita', 'brunch-en-pocitos']))
    expect(drafts.find((guide) => guide.slug === 'sushi-para-una-cita')?.neighborhood).toBeUndefined()
    expect(drafts.find((guide) => guide.slug === 'brunch-en-pocitos')?.neighborhood).toBe('POCITOS')
  })

  it('en producción (y en el build) no existen: ni página, ni params, ni barrio, ni sitemap', () => {
    const visible = visibleGuides(production)
    expect(visible.every((guide) => !guide.draft)).toBe(true)
    const paths = guideSitemapPages(visible).map((page) => page.path)
    for (const draft of drafts) expect(paths).not.toContain(guidePath(draft))
    expect(paths).not.toContain('/guides/montevideo/pocitos')
    expect(neighborhoodGuides('cordon', visible).map((guide) => guide.slug)).toEqual(['cafes-donde-nadie-te-apura'])
  })

  it('con next dev se ven (también Pocitos y la guía de ciudad)', () => {
    const visible = visibleGuides(development)
    expect(neighborhoodParams(visible)).toEqual([{ segment: 'cordon' }, { segment: 'pocitos' }])
    expect(cityGuideParams(visible)).toEqual([{ segment: 'sushi-para-una-cita' }])
  })

  it('sin variable (tests, scripts) cuentan como producción', () => {
    expect(visibleGuides({}).some((guide) => guide.draft)).toBe(false)
  })
})

describe('migas', () => {
  it('barrio: Guías de Montevideo (link) / Cordón (actual)', () => {
    expect(neighborhoodBreadcrumb('CORDON')).toEqual([
      { label: 'Guías de Montevideo', href: '/guides/montevideo' },
      { label: 'Cordón', href: '/guides/montevideo/cordon', current: true },
    ])
  })

  it('guía de barrio: Guías de Montevideo / Cordón / título (actual)', () => {
    const guide = findGuide('cordon', 'cafes-donde-nadie-te-apura')!
    expect(guideBreadcrumb(guide)).toEqual([
      { label: 'Guías de Montevideo', href: '/guides/montevideo' },
      { label: 'Cordón', href: '/guides/montevideo/cordon' },
      { label: 'Cafés donde nadie te apura', href: '/guides/montevideo/cordon/cafes-donde-nadie-te-apura', current: true },
    ])
  })

  it('guía de ciudad: Guías de Montevideo / título (actual), sin barrio', () => {
    const guide = findCityGuide('sushi-para-una-cita', visibleGuides(development))!
    expect(guideBreadcrumb(guide)).toEqual([
      { label: 'Guías de Montevideo', href: '/guides/montevideo' },
      { label: 'Lugares de sushi para una cita', href: '/guides/montevideo/sushi-para-una-cita', current: true },
    ])
  })
})

describe('sitemap', () => {
  it('en producción: la ciudad, el barrio y su guía, con la fecha de la guía más nueva', () => {
    expect(guideSitemapPages(visibleGuides(production))).toEqual([
      { path: '/guides/montevideo', updatedAt: '2026-11-19' },
      { path: '/guides/montevideo/cordon', updatedAt: '2026-11-19' },
      { path: '/guides/montevideo/cordon/cafes-donde-nadie-te-apura', updatedAt: '2026-11-19' },
    ])
  })

  it('con guías de ciudad, van al final; /guides nunca (es un redirect)', () => {
    const paths = guideSitemapPages(visibleGuides(development)).map((page) => page.path)
    expect(paths[0]).toBe('/guides/montevideo')
    expect(paths.at(-1)).toBe('/guides/montevideo/sushi-para-una-cita')
    expect(paths).toContain('/guides/montevideo/pocitos')
    expect(paths).not.toContain('/guides')
  })

  it('sin guías, nada', () => {
    expect(guideSitemapPages([])).toEqual([])
  })
})
