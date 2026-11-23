import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SITE_URL } from '@/lib/site'
import { placeOgVersion } from '../model'

const row = { slug: 'no-tan-santos', name: 'No Tan Santos', neighborhood_id: 'CARRASCO', categories: ['grill'], description_es: 'Parrilla.', logo_key: 'logos/n-07dc7ae6.webp', logo_bg_color: '#000000' }
const version = placeOgVersion({ name: row.name, logoKey: row.logo_key, logoBgColor: row.logo_bg_color })

vi.mock('@/server/places/place', async (original) => ({
  ...(await original<typeof import('@/server/places/place')>()),
  getPublishedPlace: vi.fn(async (slug: string) => (slug === row.slug ? row : null)),
}))
vi.mock('next/server', () => ({ connection: async () => {} }))
vi.mock('@/components/pages/PlacePage/PlacePage', () => ({ default: () => null }))
// Nada de la imagen ni de la metadata puede llegar a Google.
vi.mock('@/server/places/google', () => {
  throw new Error('la imagen para compartir no puede usar Google Places')
})
const render = vi.fn(async () => new Response('png', { headers: { 'cache-control': 'public, immutable, max-age=31536000' } }))
vi.mock('@/server/og/place-image', async (original) => ({
  ...(await original<typeof import('../place-image')>()),
  placeOgParts: vi.fn(async () => ({})),
  renderPlaceOg: () => render(),
}))

const ROUTE = path.resolve(import.meta.dirname, '../../../app/place/[slug]')
const params = (slug: string, v: string) => ({ params: Promise.resolve({ slug, version: v }) })

describe('metadata de la ficha', () => {
  it('og:image con la versión, absoluta en el dominio principal, ancho, alto, alt y summary_large_image', async () => {
    const { generateMetadata } = await import('@/app/place/[slug]/page')
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: row.slug }) } as Parameters<typeof generateMetadata>[0])
    const image = { url: `/place/no-tan-santos/og/${version}`, width: 1200, height: 630, alt: 'Logo de No Tan Santos', type: 'image/jpeg' }
    expect(metadata.openGraph?.images).toEqual([image])
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image', images: [image] })
    // metadataBase (layout) = SITE_URL: así sale en el HTML.
    expect(fs.readFileSync(path.resolve(ROUTE, '../../layout.tsx'), 'utf8')).toMatch(/metadataBase: new URL\(SITE_URL\)/)
    expect(new URL(image.url, SITE_URL).href).toBe(`https://www.adondevamos.com.uy/place/no-tan-santos/og/${version}`)
  })
})

describe('GET /place/[slug]/og/[version]', () => {
  it('la versión actual: la imagen con caché larga', async () => {
    const { GET } = await import('@/app/place/[slug]/og/[version]/route')
    const response = await GET(new Request('http://x'), params(row.slug, version))
    expect(response.headers.get('cache-control')).toMatch(/max-age=31536000/)
  })

  it('una versión vieja: la imagen actual con caché corta', async () => {
    const { GET } = await import('@/app/place/[slug]/og/[version]/route')
    const response = await GET(new Request('http://x'), params(row.slug, '00000000'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toMatch(/max-age=300/)
  })

  it('ficha no publicada: 404 sin generar nada', async () => {
    const { GET } = await import('@/app/place/[slug]/og/[version]/route')
    render.mockClear()
    expect((await GET(new Request('http://x'), params('otra', version))).status).toBe(404)
    expect(render).not.toHaveBeenCalled()
  })

  it('el código de la imagen no nombra a Google', () => {
    for (const file of ['og/[version]/route.tsx', '../../../server/og/place-image.tsx', '../../../server/og/logo.ts', '../../../server/og/font.ts', '../../../server/og/model.ts']) {
      expect(fs.readFileSync(path.join(ROUTE, file), 'utf8')).not.toMatch(/places\/google|googleapis|fetchPlaceDetails/)
    }
  })
})
