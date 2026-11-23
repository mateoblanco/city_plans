import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Nada de la imagen puede llegar a Google: si alguien importa el cliente de Places, el test se rompe.
vi.mock('@/server/places/google', () => {
  throw new Error('la imagen para compartir no puede usar Google Places')
})

const place = { name: 'No Tan Santos', logo_key: 'logos/no-tan-santos-07dc7ae6.webp', logo_bg_color: '#000000' }
const font = { name: 'Switzer', data: new ArrayBuffer(8), weight: 600 as const, style: 'normal' as const }

describe('placeOgParts', () => {
  beforeEach(() => {
    vi.stubEnv('LOGO_BASE_URL', 'https://logos.example')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('con logo: pide el logo de R2 y no la fuente; caché larga', async () => {
    const { placeOgParts } = await import('../place-image')
    const loadLogo = vi.fn(async () => ({ src: 'data:image/png;base64,AA==', width: 300, height: 300 }))
    const loadFont = vi.fn(async () => font)
    const parts = await placeOgParts(place, { loadLogo, loadFont })
    expect(loadLogo).toHaveBeenCalledWith('https://logos.example/logos/no-tan-santos-07dc7ae6.webp')
    expect(loadFont).not.toHaveBeenCalled()
    expect(parts).toMatchObject({ model: { kind: 'logo', bandColor: '#000000' }, degraded: false })
  })

  it('si el logo no carga: la versión sin logo, con caché corta', async () => {
    const { placeOgParts } = await import('../place-image')
    const parts = await placeOgParts(place, { loadLogo: async () => null, loadFont: async () => font })
    expect(parts).toMatchObject({ model: { kind: 'name', name: 'No Tan Santos' }, logo: null, font, degraded: true })
  })

  it('sin logo: el nombre con la fuente; sin fuente, igual sale (caché corta)', async () => {
    const { placeOgParts } = await import('../place-image')
    const noLogo = { ...place, logo_key: null, logo_bg_color: null }
    const loadLogo = vi.fn()
    expect(await placeOgParts(noLogo, { loadLogo, loadFont: async () => font })).toMatchObject({ model: { kind: 'name' }, degraded: false })
    expect(loadLogo).not.toHaveBeenCalled()
    expect(await placeOgParts(noLogo, { loadLogo, loadFont: async () => null })).toMatchObject({ model: { kind: 'name' }, font: null, degraded: true })
  })
})

describe('loadLogoPng', () => {
  it('cualquier falla del logo da null, nunca un error', async () => {
    const { loadLogoPng } = await import('../logo')
    const reject = (async () => { throw new Error('red') }) as unknown as typeof fetch
    const status = (async () => new Response('x', { status: 404, headers: { 'content-type': 'image/webp' } })) as typeof fetch
    const notImage = (async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })) as typeof fetch
    const broken = (async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/webp' } })) as typeof fetch
    for (const fetcher of [reject, status, notImage, broken]) expect(await loadLogoPng('https://logos.example/x.webp', fetcher)).toBeNull()
  })

  it('un WebP válido sale como PNG del tamaño en que se dibuja', async () => {
    const sharp = (await import('sharp')).default
    const webp = await sharp({ create: { width: 1000, height: 500, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } } }).webp().toBuffer()
    const { loadLogoPng } = await import('../logo')
    const logo = await loadLogoPng('https://logos.example/x.webp', (async () => new Response(new Uint8Array(webp), { headers: { 'content-type': 'image/webp' } })) as typeof fetch)
    expect(logo?.src.startsWith('data:image/png;base64,')).toBe(true)
    expect(logo).toMatchObject({ width: 364, height: 182 })
  })
})

describe('fuente de Fontshare', () => {
  it('toma el .ttf del CSS y nunca otro host', async () => {
    const { loadSwitzer600, resetFontCache, ttfUrlFromCss } = await import('../font')
    const css = "src: url('//cdn.fontshare.com/wf/A/B.woff2') format('woff2'), url('//cdn.fontshare.com/wf/A/B.ttf') format('truetype');"
    expect(ttfUrlFromCss(css)).toBe('https://cdn.fontshare.com/wf/A/B.ttf')

    const hosts: string[] = []
    const fetcher = (async (url: string) => {
      hosts.push(new URL(url).host)
      return url.endsWith('.ttf') ? new Response(new Uint8Array([0, 1])) : new Response(css)
    }) as unknown as typeof fetch
    resetFontCache()
    expect(await loadSwitzer600(fetcher)).toMatchObject({ name: 'Switzer', weight: 600 })
    expect(hosts).toEqual(['api.fontshare.com', 'cdn.fontshare.com'])
    resetFontCache()
  })

  it('si Fontshare falla, null (y se reintenta la próxima)', async () => {
    const { loadSwitzer600, resetFontCache } = await import('../font')
    resetFontCache()
    const fail = (async () => { throw new Error('caído') }) as unknown as typeof fetch
    expect(await loadSwitzer600(fail)).toBeNull()
    const ok = (async (url: string) => (url.endsWith('.ttf') ? new Response(new Uint8Array([0])) : new Response("url('//cdn.fontshare.com/a.ttf')"))) as unknown as typeof fetch
    expect(await loadSwitzer600(ok)).not.toBeNull()
    resetFontCache()
  })
})
