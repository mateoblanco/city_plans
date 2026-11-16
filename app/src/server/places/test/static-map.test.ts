import { describe, expect, it, vi } from 'vitest'
import { markerIconBase, markerIconFile, signMapsUrl, STATIC_MAP_BREAKPOINTS, staticMapSources, staticMapUrl } from '../static-map'

vi.mock('server-only', () => ({}))

const env = {
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: 'clave',
  NEXT_PUBLIC_GOOGLE_MAP_ID: 'mapa',
  GOOGLE_MAPS_SIGNING_SECRET: 'vNIXE0xscrmjlyV-12Nj_BvUPaw=',
  SITE_URL: 'https://salimos.example',
}
const place = { lat: -34.9055, lng: -56.191234567, iconCategory: 'coffee' as const }

describe('signMapsUrl', () => {
  it('el ejemplo de la documentación de firma de Google', () => {
    const url = 'http://maps.googleapis.com/maps/api/geocode/json?address=New+York&client=clientID'
    expect(signMapsUrl(url, 'vNIXE0xscrmjlyV-12Nj_BvUPaw=')).toBe(`${url}&signature=chaRF2hTJKOScPr-RQCEhZbSzIE=`)
  })
})

describe('staticMapUrl', () => {
  it('mismo zoom, Map ID, idioma y el marcador PNG público centrado', () => {
    const url = new URL(staticMapUrl({ ...place, width: 308, height: 193 }, env)!)
    expect(url.origin + url.pathname).toBe('https://maps.googleapis.com/maps/api/staticmap')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      center: '-34.905500,-56.191235',
      zoom: '16',
      size: '308x193',
      scale: '2',
      language: 'es',
      region: 'UY',
      map_id: 'mapa',
      markers: 'anchor:center|scale:2|icon:https://salimos.example/map-markers/coffee.png|-34.905500,-56.191235',
      key: 'clave',
    })
  })

  it('sin clave, nada', () => {
    expect(staticMapUrl({ ...place, width: 300, height: 188 }, { ...env, NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: '' })).toBeNull()
  })
})

describe('staticMapSources', () => {
  it('una imagen firmada por tramo, 16:10, sin pasar de 640', () => {
    const sources = staticMapSources(place, env)
    expect(sources.map((source) => source.minViewport)).toEqual([...STATIC_MAP_BREAKPOINTS])
    expect(sources[0]).toMatchObject({ width: 238, height: 149 })
    expect(sources.at(-1)).toMatchObject({ width: 640, height: 400 })
    for (const source of sources) {
      expect(source.width).toBeLessThanOrEqual(640)
      expect(new URL(source.url).searchParams.get('signature')).toMatch(/^[A-Za-z0-9_-]{27}=$/)
      // La firma es de la URL sin firmar de ese tamaño.
      expect(source.url).toBe(signMapsUrl(staticMapUrl({ ...place, width: source.width, height: source.height }, env)!, env.GOOGLE_MAPS_SIGNING_SECRET))
    }
  })

  it('sin secreto de firma no hay imagen (nunca una URL sin firmar)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(staticMapSources(place, { ...env, GOOGLE_MAPS_SIGNING_SECRET: undefined })).toEqual([])
  })
})

describe('marcador', () => {
  it('el PNG de la categoría o el genérico', () => {
    expect(markerIconFile('pizza')).toBe('pizza.png')
    expect(markerIconFile(null)).toBe('default.png')
  })

  it('el PNG sale del sitio en producción y del propio deploy en un preview', () => {
    expect(markerIconBase({ SITE_URL: 'https://salimos.example' })).toBe('https://salimos.example')
    expect(markerIconBase({ SITE_URL: 'https://salimos.example', VERCEL_ENV: 'preview', VERCEL_BRANCH_URL: 'rama.vercel.app' })).toBe('https://rama.vercel.app')
  })
})
