import { describe, expect, it } from 'vitest'
import { MIN_NEIGHBORHOOD_GUIDES, slugClashesWithNeighborhood } from '@shared/guides.ts'
import {
  activeNeighborhoods,
  citySeo,
  EMPTY_PARAM,
  findGuide,
  guideBreadcrumb,
  guidePath,
  liveGuides,
  neighborhoodBreadcrumb,
  neighborhoodPath,
  neighborhoodSeo,
  neighborhoodSlug,
  resolveCitySegment,
  segmentParams,
} from '../catalog'
import { guideSitemapPages } from '../sitemap'
import { ALL_GUIDES, CORDON_BEERS, CORDON_CAFES, CORDON_TAPAS, POCITOS_EMPTY, POCITOS_PIZZA, PUBLISHED_GUIDES, SUSHI_CITY, testGuide } from './fixtures'

describe('URL plana', () => {
  it('toda guía, de barrio o de ciudad, va en /guides/montevideo/<slug>', () => {
    expect(guidePath(CORDON_CAFES)).toBe('/guides/montevideo/cafes-donde-nadie-te-apura')
    expect(guidePath(POCITOS_PIZZA)).toBe('/guides/montevideo/pizzas-en-pocitos')
    expect(guidePath(SUSHI_CITY)).toBe('/guides/montevideo/sushi-para-una-cita')
  })

  it('se encuentra por slug, de barrio o de ciudad', () => {
    expect(findGuide('cafes-donde-nadie-te-apura', ALL_GUIDES)).toBe(CORDON_CAFES)
    expect(findGuide('sushi-para-una-cita', ALL_GUIDES)).toBe(SUSHI_CITY)
    expect(findGuide('xyz', ALL_GUIDES)).toBeNull()
  })

  it('el slug de una guía sigue sin poder ser el de un barrio (las páginas de barrio están al mismo nivel)', () => {
    expect(slugClashesWithNeighborhood('cordon')).toBe(true)
    expect(slugClashesWithNeighborhood('pocitos')).toBe(true)
    expect(slugClashesWithNeighborhood('cafes-donde-nadie-te-apura')).toBe(false)
  })
})

describe(`páginas de barrio: existen con ${MIN_NEIGHBORHOOD_GUIDES} guías con página`, () => {
  it('Cordón llega (3 publicadas con lugares; el borrador no cuenta); Pocitos no (1, y una sin lugares publicados no cuenta)', () => {
    expect([...activeNeighborhoods(ALL_GUIDES)]).toEqual(['CORDON'])
  })

  it('el mínimo es configurable en un solo lugar', () => {
    expect([...activeNeighborhoods(ALL_GUIDES, 1)].sort()).toEqual(['CORDON', 'POCITOS'])
    expect([...activeNeighborhoods(ALL_GUIDES, 4)]).toEqual([])
  })

  it('el segmento: un barrio con página, una guía con página, o nada (404)', () => {
    expect(resolveCitySegment('cordon', PUBLISHED_GUIDES)).toEqual({ kind: 'neighborhood' })
    expect(resolveCitySegment('pocitos', PUBLISHED_GUIDES)).toBeNull()
    expect(resolveCitySegment('pizzas-en-pocitos', PUBLISHED_GUIDES)).toMatchObject({ kind: 'guide', guide: POCITOS_PIZZA })
    expect(resolveCitySegment('cafes-donde-nadie-te-apura', PUBLISHED_GUIDES)).toMatchObject({ kind: 'guide', guide: CORDON_CAFES })
    // Sin página: borrador, sin lugares publicados, inexistente.
    expect(resolveCitySegment('cervezas-artesanales', ALL_GUIDES)).toBeNull()
    expect(resolveCitySegment('brunch-en-pocitos', PUBLISHED_GUIDES)).toBeNull()
    expect(resolveCitySegment('xyz', PUBLISHED_GUIDES)).toBeNull()
  })

  it('un barrio que pasa a tener 3 guías aparece solo', () => {
    const more = [...PUBLISHED_GUIDES, testGuide({ slug: 'p2', neighborhood: 'POCITOS' }), testGuide({ slug: 'p3', neighborhood: 'POCITOS' })]
    expect(resolveCitySegment('pocitos', more)).toEqual({ kind: 'neighborhood' })
  })
})

describe('params', () => {
  it('los barrios con página y todas las guías con página; ni borradores, ni sin lugares, ni barrios debajo del mínimo', () => {
    expect(segmentParams(ALL_GUIDES).map((param) => param.segment)).toEqual([
      'cordon',
      'cafes-donde-nadie-te-apura',
      'sushi-para-una-cita',
      'tapas-en-cordon',
      'vinos-en-cordon',
      'pizzas-en-pocitos',
    ])
    expect(liveGuides(ALL_GUIDES)).not.toContain(CORDON_BEERS)
  })

  it('sin guías en la base, un param que no existe (cacheComponents no acepta una lista vacía)', () => {
    expect(segmentParams([])).toEqual([{ segment: EMPTY_PARAM }])
    expect(segmentParams([POCITOS_EMPTY, CORDON_BEERS])).toEqual([{ segment: EMPTY_PARAM }])
    expect(resolveCitySegment(EMPTY_PARAM, [])).toBeNull()
  })

  it('el barrio va sin tildes ni mayúsculas, con guiones', () => {
    expect(neighborhoodSlug('CIUDAD VIEJA')).toBe('ciudad-vieja')
    expect(neighborhoodSlug('PRADO NUEVA SAVONA')).toBe('prado')
    expect(neighborhoodPath('montevideo', 'CORDON')).toBe('/guides/montevideo/cordon')
  })
})

describe('lo de Google de ciudad y barrio', () => {
  it('título de plantilla; descripción con el comienzo de la intro, o la plantilla sin intro', () => {
    expect(neighborhoodSeo('Cordón', []).seoDescription).toBe('Cafés, bares y dónde comer en Cordón, Montevideo: listas elegidas a mano, con horarios y mapa.')
    const long = 'Cordón es de los barrios con más para salir en Montevideo: cafés de especialidad, cervecerías artesanales y bares de tapas, muchos en casonas viejas y talleres reciclados.'
    const seo = neighborhoodSeo('Cordón', [long])
    expect(seo.seoDescription.length).toBeLessThanOrEqual(155)
    expect(seo.seoDescription.endsWith('…')).toBe(true)
    expect(citySeo(['Listas cortas.']).seoDescription).toBe('Listas cortas.')
  })
})

describe('migas', () => {
  const active = activeNeighborhoods(ALL_GUIDES)

  it('barrio: Guías de Montevideo (link) / Cordón (actual)', () => {
    expect(neighborhoodBreadcrumb('CORDON')).toEqual([
      { label: 'Montevideo', href: '/guides/montevideo' },
      { label: 'Cordón', href: '/guides/montevideo/cordon', current: true },
    ])
  })

  it('guía de un barrio con página: Guías de Montevideo / Cordón (link) / título', () => {
    expect(guideBreadcrumb(CORDON_CAFES, active)).toEqual([
      { label: 'Montevideo', href: '/guides/montevideo' },
      { label: 'Cordón', href: '/guides/montevideo/cordon' },
      { label: 'Cafés donde nadie te apura', href: '/guides/montevideo/cafes-donde-nadie-te-apura', current: true },
    ])
  })

  it('guía de un barrio sin página, o de toda la ciudad: Guías de Montevideo / título', () => {
    expect(guideBreadcrumb(POCITOS_PIZZA, active)).toEqual([
      { label: 'Montevideo', href: '/guides/montevideo' },
      { label: POCITOS_PIZZA.title, href: '/guides/montevideo/pizzas-en-pocitos', current: true },
    ])
    expect(guideBreadcrumb(SUSHI_CITY, active).map((crumb) => crumb.label)).toEqual(['Montevideo', 'Lugares de sushi para una cita'])
  })
})

describe('sitemap', () => {
  it('la ciudad, los barrios con página y todas las guías con página en su URL plana; Pocitos (debajo del mínimo) no', () => {
    expect(guideSitemapPages(ALL_GUIDES)).toEqual([
      { path: '/guides/montevideo', updatedAt: '2026-11-20' },
      { path: '/guides/montevideo/cordon', updatedAt: '2026-11-19' },
      { path: '/guides/montevideo/cafes-donde-nadie-te-apura', updatedAt: '2026-11-19' },
      { path: '/guides/montevideo/sushi-para-una-cita', updatedAt: '2026-11-20' },
      { path: '/guides/montevideo/tapas-en-cordon', updatedAt: '2026-11-19' },
      { path: '/guides/montevideo/vinos-en-cordon', updatedAt: '2026-11-18' },
      { path: '/guides/montevideo/pizzas-en-pocitos', updatedAt: '2026-11-19' },
    ])
    const paths = guideSitemapPages(ALL_GUIDES).map((page) => page.path)
    expect(paths).not.toContain('/guides/montevideo/pocitos')
    expect(paths.some((path) => path.split('/').length > 4)).toBe(false)
  })

  it('sin guías con página, nada', () => {
    expect(guideSitemapPages([])).toEqual([])
    expect(guideSitemapPages([POCITOS_EMPTY, CORDON_BEERS])).toEqual([])
  })

  it('con barrios debajo del mínimo, ningún barrio', () => {
    expect(guideSitemapPages([CORDON_CAFES, CORDON_TAPAS, SUSHI_CITY]).map((page) => page.path)).toEqual([
      '/guides/montevideo',
      '/guides/montevideo/cafes-donde-nadie-te-apura',
      '/guides/montevideo/tapas-en-cordon',
      '/guides/montevideo/sushi-para-una-cita',
    ])
  })
})

