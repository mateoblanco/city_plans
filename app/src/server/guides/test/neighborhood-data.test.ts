import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GUIDES } from '../catalog'

// Sin Next ni Neon: la cache es un no-op y la base devuelve como publicados todos los lugares de las guías.
vi.mock('next/cache', () => ({ cacheLife: () => {}, cacheTag: () => {} }))
const query = vi.fn()
vi.mock('../../db', () => ({ getSql: () => ({ query }) }))

const published = (ids: string[]) =>
  ids.map((id) => ({
    id,
    slug: id,
    name: id,
    neighborhoodId: 'CORDON',
    categories: ['cafe'],
    iconCategory: null,
    logoKey: null,
    logoBgColor: null,
    hours: { slots: [], status: 'none' },
    lat: -34.9,
    lng: -56.17,
  }))

const allIds = GUIDES.flatMap((guide) => guide.places.map((place) => place.id))

describe('getNeighborhoodPage', () => {
  beforeEach(() => {
    query.mockReset()
    query.mockResolvedValue(published(allIds))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('un barrio sin guías es 404 (null), sin consultar la base', async () => {
    const { getNeighborhoodPage } = await import('../neighborhood-data')
    expect(await getNeighborhoodPage('pocitos')).toBeNull()
    expect(query).not.toHaveBeenCalled()
  })

  it('sin ningún lugar publicado en sus guías, también 404', async () => {
    query.mockResolvedValue([])
    const { getNeighborhoodPage } = await import('../neighborhood-data')
    expect(await getNeighborhoodPage('cordon')).toBeNull()
  })

  it('en producción, los borradores no aparecen: Cordón sólo tiene Cafés', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { getNeighborhoodPage } = await import('../neighborhood-data')
    const page = await getNeighborhoodPage('cordon')
    expect(page?.groups.map((group) => group.group)).toEqual(['cafes'])
    expect(page?.groups[0].guides.map((guide) => guide.slug)).toEqual(['cafes-donde-nadie-te-apura'])
    // La consulta sólo pide los lugares de las guías publicadas.
    const drafts = GUIDES.filter((guide) => guide.draft).flatMap((guide) => guide.places.map((place) => place.id))
    const asked: string[] = query.mock.calls[0][1][0]
    expect(asked.some((id) => drafts.includes(id) && !GUIDES.some((guide) => !guide.draft && guide.places.some((place) => place.id === id)))).toBe(false)
  })

  it('en desarrollo, los borradores se ven, en el orden de la app', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { getNeighborhoodPage } = await import('../neighborhood-data')
    const page = await getNeighborhoodPage('cordon')
    expect(page?.groups.map((group) => group.title)).toEqual(['Comer', 'Tomar algo', 'Cafés', 'Postres'])
  })

  it('el barrio trae su nombre, su ruta y el texto del config', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { getNeighborhoodPage } = await import('../neighborhood-data')
    const page = await getNeighborhoodPage('cordon')
    expect(page).toMatchObject({ id: 'CORDON', name: 'Cordón', path: '/guides/montevideo/cordon' })
    expect(page?.breadcrumb.map((crumb) => [crumb.label, crumb.href, !!crumb.current])).toEqual([
      ['Guías de Montevideo', '/guides/montevideo', false],
      ['Cordón', '/guides/montevideo/cordon', true],
    ])
    expect(page?.intro.length).toBeGreaterThan(0)
    expect(page?.seoTitle).toMatch(/Cordón/)
  })
})
