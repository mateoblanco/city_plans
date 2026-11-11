import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DISCOUNTS_USER_AGENT, parseRobots, politeFetcher, rawFetcher, robotsAllows } from './polite-fetch.ts'

const ROBOTS = 'User-agent: *\n\nDisallow: *.content.html\nAllow: /\n\nSitemap: https://www.bbva.com.uy/sitemap.xml'

describe('robots.txt', () => {
  it('aplica las reglas de User-agent: * con comodines', () => {
    const rules = parseRobots(ROBOTS)
    expect(robotsAllows(rules, '/personas/productos/tarjetas/descuentos/gastronomia.html')).toBe(true)
    expect(robotsAllows(rules, '/personas/productos/tarjetas/descuentos/gastronomia.pag-2.html')).toBe(true)
    expect(robotsAllows(rules, '/x/y.content.html')).toBe(false)
  })

  it('un BOM al principio (Scotiabank) no esconde el grupo User-agent: *', () => {
    const rules = parseRobots('\uFEFFUser-agent: *\nDisallow: /Scripts/\nDisallow: /Handlers/\n\nSitemap: https://www.scotiabank.com.uy/sitemap.xml')
    expect(robotsAllows(rules, '/Scripts/x.js')).toBe(false)
    expect(robotsAllows(rules, '/Personas/Tarjetas/Beneficios/default')).toBe(true)
  })

  it('ignora los grupos de otros user-agents y gana la regla más larga', () => {
    const rules = parseRobots('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /privado/\nAllow: /privado/publico.html')
    expect(robotsAllows(rules, '/otra.html')).toBe(true)
    expect(robotsAllows(rules, '/privado/x.html')).toBe(false)
    expect(robotsAllows(rules, '/privado/publico.html')).toBe(true)
  })
})

describe('politeFetcher', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'discounts-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  function fakeSite(pages: Record<string, { status?: number; body: string }>) {
    const calls: { url: string; userAgent: string | null }[] = []
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, userAgent: new Headers(init?.headers).get('User-Agent') })
      const page = pages[url]
      return new Response(page?.body ?? 'no', { status: page ? page.status ?? 200 : 404 })
    }) as unknown as typeof globalThis.fetch
    return { fetch, calls }
  }

  it('pide robots.txt primero, de a uno, con pausa y user-agent genérico, y guarda el HTML crudo', async () => {
    const site = fakeSite({
      'https://bank.test/robots.txt': { body: ROBOTS },
      'https://bank.test/a.html': { body: '<p>A</p>' },
      'https://bank.test/b.html': { body: '<p>B</p>' },
    })
    let clock = 1_000
    const sleeps: number[] = []
    const fetcher = politeFetcher({ dir, fetch: site.fetch, delayMs: 1_500, now: () => new Date(clock), sleep: async (ms) => { sleeps.push(ms); clock += ms } })
    expect(await Promise.all([fetcher.get('https://bank.test/a.html'), fetcher.get('https://bank.test/b.html')])).toEqual(['<p>A</p>', '<p>B</p>'])
    expect(site.calls.map((call) => call.url)).toEqual(['https://bank.test/robots.txt', 'https://bank.test/a.html', 'https://bank.test/b.html'])
    expect(site.calls.every((call) => call.userAgent === DISCOUNTS_USER_AGENT)).toBe(true)
    expect(sleeps).toEqual([1_500, 1_500])
    expect(fetcher.requests).toBe(3)

    const raw = await rawFetcher(dir)
    expect(await raw.get('https://bank.test/b.html')).toBe('<p>B</p>')
    expect(raw.requests).toBe(0)
    await expect(raw.get('https://bank.test/c.html')).rejects.toThrow('no está en el HTML crudo')
    expect(JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'))['https://bank.test/a.html'].status).toBe(200)
  })

  it('el HTML crudo en varias carpetas: primero la del proveedor, después las otras (una página compartida)', async () => {
    const own = join(dir, 'own')
    const other = join(dir, 'other')
    const site = fakeSite({ 'https://bank.test/robots.txt': { body: '' }, 'https://bank.test/a.html': { body: '<p>propia</p>' }, 'https://bank.test/shared.html': { body: '<p>compartida</p>' } })
    await politeFetcher({ dir: own, fetch: site.fetch, delayMs: 0, sleep: async () => {} }).get('https://bank.test/a.html')
    const fromOther = politeFetcher({ dir: other, fetch: site.fetch, delayMs: 0, sleep: async () => {} })
    await fromOther.get('https://bank.test/a.html')
    await fromOther.get('https://bank.test/shared.html')
    const raw = await rawFetcher([own, other, join(dir, 'missing')])
    expect(await raw.get('https://bank.test/shared.html')).toBe('<p>compartida</p>')
    expect(await raw.get('https://bank.test/a.html')).toBe('<p>propia</p>')
    await expect(rawFetcher([join(dir, 'missing'), own])).rejects.toThrow('No hay HTML crudo')
  })

  it('un PDF: en la misma cola, guardado con su extensión y releído sin red como bytes', async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0xff, 0x00, 0x80])
    const accepts: (string | null)[] = []
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      accepts.push(new Headers(init?.headers).get('Accept'))
      if (String(input).endsWith('robots.txt')) return new Response('', { status: 404 })
      return new Response(pdf, { status: 200 })
    }) as unknown as typeof globalThis.fetch
    const fetcher = politeFetcher({ dir, fetch, delayMs: 0, sleep: async () => {} })
    const url = 'https://bank.test/pdf/Listado%20GASTRONOMIA%206.11.26.pptx.pdf'
    expect(await fetcher.getBytes!(url)).toEqual(pdf)
    expect(accepts[1]).toMatch(/^application\/pdf/)
    const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'))
    expect(index[url]).toMatchObject({ status: 200, binary: true, file: expect.stringMatching(/\.pdf$/) })
    const raw = await rawFetcher(dir)
    expect(await raw.getBytes!(url)).toEqual(pdf)
  })

  it('no baja lo que robots.txt no permite', async () => {
    const site = fakeSite({ 'https://bank.test/robots.txt': { body: ROBOTS } })
    const fetcher = politeFetcher({ dir, fetch: site.fetch, delayMs: 0, sleep: async () => {} })
    await expect(fetcher.get('https://bank.test/x.content.html')).rejects.toThrow('robots.txt no permite')
    expect(site.calls).toHaveLength(1)
  })

  it('un 404 es un error claro; un 5xx se reintenta una vez', async () => {
    let attempts = 0
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('robots.txt')) return new Response('', { status: 404 })
      if (url.endsWith('flaky.html')) return new Response('ok', { status: ++attempts === 1 ? 503 : 200 })
      return new Response('', { status: 404 })
    }) as unknown as typeof globalThis.fetch
    const fetcher = politeFetcher({ dir, fetch, delayMs: 0, sleep: async () => {} })
    expect(await fetcher.get('https://bank.test/flaky.html')).toBe('ok')
    await expect(fetcher.get('https://bank.test/missing.html')).rejects.toThrow('respondió 404')
  })

  it('render: el navegador en la misma cola, con robots y pausa; el crudo renderizado pasa a ser el de esa URL', async () => {
    const site = fakeSite({ 'https://bank.test/robots.txt': { body: 'User-agent: *\nDisallow: /privado/' }, 'https://bank.test/p.html': { body: '<p>sin datos</p>' } })
    let clock = 1_000
    const sleeps: number[] = []
    const renders: { url: string; userAgent: string }[] = []
    const fetcher = politeFetcher({
      dir, fetch: site.fetch, delayMs: 1_500, now: () => new Date(clock), sleep: async (ms) => { sleeps.push(ms); clock += ms },
      renderer: async (url, { userAgent }) => { renders.push({ url, userAgent }); return { status: 200, html: '<p>con datos</p>' } },
    })
    expect(await fetcher.get('https://bank.test/p.html')).toBe('<p>sin datos</p>')
    expect(await fetcher.render!('https://bank.test/p.html')).toBe('<p>con datos</p>')
    expect(renders).toEqual([{ url: 'https://bank.test/p.html', userAgent: DISCOUNTS_USER_AGENT }])
    expect(sleeps).toEqual([1_500, 1_500])
    expect(fetcher.requests).toBe(3)
    await expect(fetcher.render!('https://bank.test/privado/x.html')).rejects.toThrow('robots.txt no permite')
    const raw = await rawFetcher(dir)
    expect(await raw.render!('https://bank.test/p.html')).toBe('<p>con datos</p>')
    expect(JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'))['https://bank.test/p.html']).toMatchObject({ file: 'bank.test_p.html.rendered.html', rendered: true })
  })

  it('render sin navegador configurado, o con un error del navegador: un error claro', async () => {
    const site = fakeSite({ 'https://bank.test/robots.txt': { body: '' } })
    await expect(politeFetcher({ dir, fetch: site.fetch, delayMs: 0, sleep: async () => {} }).render!('https://bank.test/p.html')).rejects.toThrow('No hay navegador configurado')
    const broken = politeFetcher({ dir, fetch: site.fetch, delayMs: 0, sleep: async () => {}, renderer: async () => { throw new Error('Timeout 45000ms') } })
    await expect(broken.render!('https://bank.test/p.html')).rejects.toThrow('No se pudo abrir https://bank.test/p.html en el navegador: Timeout 45000ms')
  })
})
