import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GUIDES } from '../catalog'

// Sin Next ni Neon: la cache es un no-op y la base devuelve como publicados todos los lugares de las guías.
vi.mock('next/cache', () => ({ cacheLife: () => {}, cacheTag: () => {} }))
const query = vi.fn()
vi.mock('../../db', () => ({ getSql: () => ({ query }) }))

const published = GUIDES.flatMap((guide) => guide.places).map(({ id }) => ({
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

describe('getCityPage', () => {
  beforeEach(() => {
    query.mockReset()
    query.mockResolvedValue(published)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('en producción: sólo la guía publicada (Cafés) y Cordón en Barrios; ningún borrador', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { getCityPage } = await import('../city-data')
    const page = await getCityPage()
    expect(page).toMatchObject({ title: 'Guías de Montevideo', path: '/guides/montevideo' })
    expect(page.groups.map((group) => [group.title, group.guides.map((card) => card.slug)])).toEqual([['Cafés', ['cafes-donde-nadie-te-apura']]])
    expect(page.neighborhoods.map((entry) => entry.name)).toEqual(['Cordón'])
  })

  it('en desarrollo: los borradores también (Comer mezcla Pocitos y la guía de ciudad; Barrios suma Pocitos)', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { getCityPage } = await import('../city-data')
    const page = await getCityPage()
    expect(page.groups.map((group) => group.title)).toEqual(['Comer', 'Tomar algo', 'Cafés', 'Postres'])
    const eat = page.groups[0].guides.map((card) => card.href)
    expect(eat).toEqual(expect.arrayContaining(['/guides/montevideo/sushi-para-una-cita', '/guides/montevideo/pocitos/brunch-en-pocitos', '/guides/montevideo/cordon/para-compartir-con-amigos']))
    expect(page.neighborhoods.map((entry) => entry.name)).toEqual(['Cordón', 'Pocitos'])
  })
})
