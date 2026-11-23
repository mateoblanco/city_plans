import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GUIDES_SQL, INTROS_SQL } from '../db'
import { withSiteName } from '@/lib/site'

// Sin Next ni Neon: la cache es un no-op y la base es un fake que responde según la consulta, como Neon.
vi.mock('next/cache', () => ({ cacheLife: () => {}, cacheTag: () => {} }))
const query = vi.fn()
vi.mock('../../db', () => ({ getSql: () => ({ query }) }))

type Row = {
  id: string
  slug: string
  neighborhoodId: string | null
  group: string
  status: 'draft' | 'published'
  featured?: boolean
  color?: string
  updatedAt?: string
  places: string[]
}

const PUBLISHED_PLACES = new Set(['cafe-1', 'cafe-2', 'cafe-3', 'cafe-4', 'sushi-1', 'sushi-2', 'sushi-3', 'sushi-4', 'beer-1', 'tapas-1', 'wine-1', 'pizza-1'])

let guides: Row[] = []
let intros: { neighborhoodId: string | null; intro: string }[] = []

const guideRow = (row: Row) => ({
  id: row.id,
  slug: row.slug,
  city: 'montevideo',
  neighborhoodId: row.neighborhoodId,
  group: row.group,
  title: `Título ${row.slug}`,
  seoTitle: `SEO ${row.slug}`,
  seoDescription: `Descripción ${row.slug}`,
  intro: 'Primer párrafo\nsigue.\n\nSegundo párrafo.',
  featured: row.featured ?? false,
  color: row.color ?? '#FF8E00',
  status: row.status,
  updatedAt: row.updatedAt ?? '2026-11-19',
  live: row.places.some((id) => PUBLISHED_PLACES.has(id)),
  publishedPlaces: row.places.filter((id) => PUBLISHED_PLACES.has(id)).length,
  places: row.places.map((id) => ({ id, text: `Texto ${id}` })),
})

const placeRow = (id: string) => ({
  id, slug: id, name: id.toUpperCase(), neighborhoodId: 'CORDON', categories: ['cafe'], iconCategory: null, logoKey: null, logoBgColor: null,
  lat: -34.9, lng: -56.17,
})

beforeEach(() => {
  guides = [
    { id: 'g1', slug: 'cafes-donde-nadie-te-apura', neighborhoodId: 'CORDON', group: 'cafes', status: 'published', featured: true, places: ['cafe-1', 'cafe-x', 'cafe-2', 'cafe-3', 'cafe-4'] },
    { id: 'g2', slug: 'cervezas-artesanales', neighborhoodId: 'CORDON', group: 'bars', status: 'draft', places: ['beer-1'] },
    { id: 'g3', slug: 'sushi-para-una-cita', neighborhoodId: null, group: 'eat', status: 'published', places: ['sushi-1', 'sushi-2', 'sushi-3', 'sushi-4'] },
    { id: 'g4', slug: 'brunch-en-pocitos', neighborhoodId: 'POCITOS', group: 'eat', status: 'published', places: ['nope-1'] },
    // Cordón llega al mínimo de guías con página (cafés, tapas y vinos; cervezas es borrador). Pocitos, no (pizzas sola).
    { id: 'g5', slug: 'tapas-en-cordon', neighborhoodId: 'CORDON', group: 'eat', status: 'published', color: '#6C12DD', places: ['tapas-1'] },
    { id: 'g6', slug: 'vinos-en-cordon', neighborhoodId: 'CORDON', group: 'bars', status: 'published', color: '#123456', places: ['wine-1'] },
    { id: 'g7', slug: 'pizzas-en-pocitos', neighborhoodId: 'POCITOS', group: 'eat', status: 'published', places: ['pizza-1'] },
  ]
  intros = [
    { neighborhoodId: null, intro: 'Listas cortas, elegidas a mano.' },
    { neighborhoodId: 'CORDON', intro: 'Cordón es de los barrios con más para salir.' },
  ]
  query.mockReset()
  query.mockImplementation(async (text: string, params: unknown[]) => {
    if (text === GUIDES_SQL) return guides.filter((row) => row.status === 'published' || params[1] === true).map(guideRow)
    if (text === INTROS_SQL) return intros
    // GUIDE_PLACES_SQL: sólo los publicados de los ids pedidos.
    return (params[0] as string[]).filter((id) => PUBLISHED_PLACES.has(id)).map(placeRow)
  })
})

describe('las guías se leen de la base', () => {
  it('la guía: sus lugares publicados en orden, renumerados; la intro en párrafos y la fecha', async () => {
    const { getGuidePage } = await import('../page-data')
    const page = await getGuidePage('cafes-donde-nadie-te-apura')
    expect(page?.guide).toMatchObject({ title: 'Título cafes-donde-nadie-te-apura', intro: ['Primer párrafo sigue.', 'Segundo párrafo.'], updatedAt: '2026-11-19', draft: false })
    expect(page?.places.map((place) => [place.number, place.id, place.text])).toEqual([
      [1, 'cafe-1', 'Texto cafe-1'],
      [2, 'cafe-2', 'Texto cafe-2'],
      [3, 'cafe-3', 'Texto cafe-3'],
      [4, 'cafe-4', 'Texto cafe-4'],
    ])
    // Cordón tiene página: la etiqueta y las migas con el barrio.
    expect(page?.neighborhoodLabel).toBe('Cordón')
    expect(page?.breadcrumb.map((crumb) => crumb.href)).toEqual(['/guides/montevideo', '/guides/montevideo/cordon', '/guides/montevideo/cafes-donde-nadie-te-apura'])
    // Sólo pide las publicadas (status = 'published': el segundo parámetro es false).
    expect(query.mock.calls.find(([text]) => text === GUIDES_SQL)?.[1]).toEqual(['montevideo', false])
  })

  it('un borrador no existe sin la vista previa; una guía sin lugares publicados, tampoco', async () => {
    const { getGuidePage } = await import('../page-data')
    expect(await getGuidePage('cervezas-artesanales')).toBeNull()
    expect(await getGuidePage('brunch-en-pocitos')).toBeNull()
    expect(await getGuidePage('sushi-para-una-cita')).not.toBeNull()
  })

  it('una guía de un barrio sin página: etiqueta del barrio, pero migas sin él', async () => {
    const { getGuidePage } = await import('../page-data')
    const page = await getGuidePage('pizzas-en-pocitos')
    expect(page?.neighborhoodLabel).toBe('Pocitos')
    expect(page?.breadcrumb.map((crumb) => crumb.label)).toEqual(['Montevideo', 'Título pizzas-en-pocitos'])
    expect((await getGuidePage('sushi-para-una-cita'))?.neighborhoodLabel).toBeNull()
  })

  it('la vista previa lee también los borradores (sin cache), y los que no tienen lugares publicados', async () => {
    const { getGuidePreview } = await import('../page-data')
    const draft = await getGuidePreview('cervezas-artesanales')
    expect(draft?.guide.draft).toBe(true)
    expect(draft?.places.map((place) => place.id)).toEqual(['beer-1'])
    expect(query.mock.calls.find(([text]) => text === GUIDES_SQL)?.[1]).toEqual(['montevideo', true])
    expect((await getGuidePreview('brunch-en-pocitos'))?.places).toEqual([])
    expect(await getGuidePreview('no-existe')).toBeNull()
  })

  it('el barrio: sus guías publicadas por grupo (sin el borrador), su intro y lo de Google', async () => {
    const { getNeighborhoodPage } = await import('../neighborhood-data')
    const page = await getNeighborhoodPage('cordon')
    expect(page).toMatchObject({ id: 'CORDON', name: 'Cordón', path: '/guides/montevideo/cordon', intro: ['Cordón es de los barrios con más para salir.'] })
    expect(page?.groups.map((group) => [group.title, group.guides.map((card) => [card.slug, card.count])])).toEqual([
      ['Comer', [['tapas-en-cordon', 1]]],
      ['Tomar algo', [['vinos-en-cordon', 1]]],
      ['Cafés', [['cafes-donde-nadie-te-apura', 4]]],
    ])
    expect(page?.groups[2].guides[0].href).toBe('/guides/montevideo/cafes-donde-nadie-te-apura')
    expect(page?.seoTitle).toBe(withSiteName('Guías de Cordón, Montevideo'))
    expect(page?.seoDescription).toBe('Cordón es de los barrios con más para salir.')
  })

  it('un barrio debajo del mínimo es 404 (null): Pocitos tiene una guía con página y otra sin lugares publicados', async () => {
    const { getNeighborhoodPage } = await import('../neighborhood-data')
    expect(await getNeighborhoodPage('pocitos')).toBeNull()
    expect(await getNeighborhoodPage('ciudad-vieja')).toBeNull()
  })

  it('un barrio sin intro: sin introducción y la descripción de plantilla', async () => {
    intros = []
    const { getNeighborhoodPage } = await import('../neighborhood-data')
    const page = await getNeighborhoodPage('cordon')
    expect(page?.intro).toEqual([])
    expect(page?.seoDescription).toMatch(/^Cafés, bares y dónde comer en Cordón/)
  })

  it('la ciudad: grupos con las publicadas (destacadas o recientes), los barrios con página y su intro', async () => {
    const { getCityPage } = await import('../city-data')
    const page = await getCityPage()
    expect(page).toMatchObject({ title: 'Montevideo', path: '/guides/montevideo', intro: ['Listas cortas, elegidas a mano.'], seoDescription: 'Listas cortas, elegidas a mano.' })
    expect(page.groups.map((group) => [group.title, group.guides.map((card) => card.href)])).toEqual([
      ['Comer', ['/guides/montevideo/sushi-para-una-cita', '/guides/montevideo/tapas-en-cordon', '/guides/montevideo/pizzas-en-pocitos']],
      ['Tomar algo', ['/guides/montevideo/vinos-en-cordon']],
      ['Cafés', ['/guides/montevideo/cafes-donde-nadie-te-apura']],
    ])
    // Las tarjetas llevan el barrio como etiqueta; la de ciudad, no.
    expect(page.groups[0].guides.map((card) => card.neighborhood)).toEqual([null, 'Cordón', 'Pocitos'])
    // "Barrios": sólo los que llegan al mínimo (Pocitos tiene guías, pero no llega).
    expect(page.neighborhoods.map((entry) => entry.name)).toEqual(['Cordón'])
  })

  it('si ningún barrio llega al mínimo, la sección Barrios queda vacía (no se muestra)', async () => {
    guides = guides.filter((row) => row.slug !== 'vinos-en-cordon')
    const { getCityPage } = await import('../city-data')
    expect((await getCityPage()).neighborhoods).toEqual([])
    const { getNeighborhoodPage } = await import('../neighborhood-data')
    expect(await getNeighborhoodPage('cordon')).toBeNull()
  })

  it('la ciudad sin ninguna guía: sale con el título, sin filas ni barrios', async () => {
    guides = []
    const { getCityPage } = await import('../city-data')
    const page = await getCityPage()
    expect(page.groups).toEqual([])
    expect(page.neighborhoods).toEqual([])
  })

  it('home: las guías publicadas con página, destacadas primero, con barrio y lugares publicados; sin guías, vacío', async () => {
    const { getHomeGuides } = await import('../home-data')
    const home = await getHomeGuides()
    expect(home[0]).toEqual({ slug: 'cafes-donde-nadie-te-apura', title: 'Título cafes-donde-nadie-te-apura', href: '/guides/montevideo/cafes-donde-nadie-te-apura', neighborhood: 'Cordón', count: 4 })
    expect(home.map((guide) => guide.slug)).not.toContain('cervezas-artesanales')
    expect(home.map((guide) => guide.slug)).not.toContain('brunch-en-pocitos')
    guides = []
    expect(await getHomeGuides()).toEqual([])
  })

  it('ficha: sólo las guías publicadas (con página) que incluyen el lugar', async () => {
    const { getPlaceGuides } = await import('../place-data')
    expect((await getPlaceGuides('cafe-2')).map((guide) => guide.slug)).toEqual(['cafes-donde-nadie-te-apura'])
    // beer-1 sólo está en un borrador.
    expect(await getPlaceGuides('beer-1')).toEqual([])
  })

  it('guía: "Más guías" sin la actual, como tarjetas, con los lugares en la misma consulta', async () => {
    const { getGuidePage } = await import('../page-data')
    query.mockClear()
    const page = await getGuidePage('cafes-donde-nadie-te-apura')
    expect(page?.related.map((card) => card.slug)).not.toContain('cafes-donde-nadie-te-apura')
    // Mismo grupo (ninguna), después mismo barrio (Cordón: tapas y vinos), después las más recientes.
    expect(page?.related.map((card) => card.slug).slice(0, 2).sort()).toEqual(['tapas-en-cordon', 'vinos-en-cordon'])
    expect(page?.related.length).toBeLessThanOrEqual(4)
    expect(page?.related[0].count).toBe(1)
    // El color de cada tarjeta es el de su guía; uno fuera de la paleta cae al de por defecto.
    const colors = Object.fromEntries(page!.related.map((card) => [card.slug, card.color]))
    expect(colors['tapas-en-cordon']).toBe('#6C12DD')
    expect(colors['vinos-en-cordon']).toBe('#FF8E00')
    const placeQueries = query.mock.calls.filter(([text]) => text !== GUIDES_SQL && text !== INTROS_SQL)
    expect(placeQueries).toHaveLength(1)
  })
})
