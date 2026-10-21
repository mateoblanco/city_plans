import { describe, expect, it, vi } from 'vitest'
import { ApifyInstagramProvider } from './apify-instagram-provider.ts'
import { RateLimitError, TransientProviderError } from './rate-limit.ts'

describe('ApifyInstagramProvider', () => {
  it('envía sólo el username y normaliza nombre, bio y links', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      url: 'https://www.instagram.com/cafe.central/',
      username: 'cafe.central',
      fullName: 'Café Central',
      biography: 'Café de especialidad · 9 a 20 h',
      externalUrl: 'https://cafe.example/',
      externalUrls: [
        { url: 'https://reservas.example/cafe' },
        { url: 'https://cafe.example/' },
      ],
    }]), { status: 200 }))
    const provider = new ApifyInstagramProvider(
      { token: 'secret-token' },
      fetcher,
    )

    const result = await provider.scrape('https://www.instagram.com/cafe.central/')

    expect(result).toEqual({
      url: 'https://www.instagram.com/cafe.central/',
      name: 'Café Central',
      bio: 'Café de especialidad · 9 a 20 h',
      links: ['https://cafe.example/', 'https://reservas.example/cafe'],
    })
    const [url, init] = fetcher.mock.calls[0]
    expect(String(url)).toContain('/v2/actors/apify~instagram-profile-scraper/run-sync-get-dataset-items')
    expect(init.headers.Authorization).toBe('Bearer secret-token')
    expect(JSON.parse(init.body)).toEqual({
      usernames: ['cafe.central'],
      includeAboutSection: false,
    })
  })

  it('lee los seguidores del perfil e ignora valores que no son un entero', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { username: 'cafe.uno', fullName: 'Café Uno', followersCount: 12_345 },
      { username: 'cafe.dos', fullName: 'Café Dos', followersCount: '12k' },
    ]), { status: 200 }))
    const provider = new ApifyInstagramProvider({ token: 'secret' }, fetcher)

    const [uno, dos] = await provider.scrapeMany(['https://www.instagram.com/cafe.uno/', 'https://www.instagram.com/cafe.dos/'])

    expect(uno.followers).toBe(12_345)
    expect(dos).not.toHaveProperty('followers')
  })

  it('prefiere la foto de perfil HD y cae a la común', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { username: 'cafe.uno', profilePicUrl: 'https://cdn.example/uno-150.jpg', profilePicUrlHD: 'https://cdn.example/uno-hd.jpg' },
      { username: 'cafe.dos', profilePicUrl: 'https://cdn.example/dos-150.jpg' },
      { username: 'cafe.tres' },
    ]), { status: 200 }))
    const provider = new ApifyInstagramProvider({ token: 'secret' }, fetcher)

    const [uno, dos, tres] = await provider.scrapeMany(['https://www.instagram.com/cafe.uno/'])

    expect(uno.profilePicUrl).toBe('https://cdn.example/uno-hd.jpg')
    expect(dos.profilePicUrl).toBe('https://cdn.example/dos-150.jpg')
    expect(tres).not.toHaveProperty('profilePicUrl')
  })

  it('informa configuración, autorización y cuota sin filtrar secretos', async () => {
    await expect(
      new ApifyInstagramProvider({}).scrape('https://instagram.com/cafe/'),
    ).rejects.toMatchObject({ kind: 'configuration' })

    const unauthorized = new ApifyInstagramProvider(
      { token: 'secret' },
      vi.fn().mockResolvedValue(new Response('', { status: 401 })),
    )
    await expect(unauthorized.scrape('https://instagram.com/cafe/'))
      .rejects.toMatchObject({ kind: 'authorization' })

    const quota = new ApifyInstagramProvider(
      { token: 'secret' },
      vi.fn().mockResolvedValue(new Response('', { status: 402 })),
    )
    await expect(quota.scrape('https://instagram.com/cafe/'))
      .rejects.toMatchObject({ kind: 'quota', message: 'Apify no tiene crédito disponible.' })
    await expect(quota.scrape('https://instagram.com/cafe/')).rejects.not.toBeInstanceOf(RateLimitError)

    // 429 es un límite temporal: se puede reintentar y trae el Retry-After.
    const limited = new ApifyInstagramProvider(
      { token: 'secret' },
      vi.fn().mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '4' } })),
    )
    const error = await limited.scrape('https://instagram.com/cafe/').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(RateLimitError)
    expect(error).toMatchObject({ kind: 'quota', service: 'apify', retryAfterMs: 4000 })
  })

  it('conserva el detalle de un error de Apify para facilitar el diagnóstico', async () => {
    const provider = new ApifyInstagramProvider(
      { token: 'secret' },
      vi.fn().mockResolvedValue(new Response(JSON.stringify({
        error: { message: 'Actor input is invalid.' },
      }), { status: 400 })),
    )

    await expect(provider.scrape('https://instagram.com/cafe/')).rejects.toMatchObject({
      kind: 'upstream',
      message: 'Apify no pudo consultar el perfil de Instagram. Actor input is invalid.',
    })
  })

  it('valida varios candidatos de Instagram en una sola ejecución', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      {
        username: 'cafe.uno',
        fullName: 'Café Uno',
        biography: 'Montevideo',
      },
      {
        url: 'https://www.instagram.com/cafe.dos/',
        username: 'cafe.dos',
        fullName: 'Café Dos',
        biography: 'Pocitos',
      },
    ]), { status: 200 }))
    const provider = new ApifyInstagramProvider({ token: 'secret' }, fetcher)

    const profiles = await provider.scrapeMany([
      'https://www.instagram.com/cafe.uno/',
      'https://www.instagram.com/cafe.dos/',
    ])

    expect(profiles.map((profile) => profile.url)).toEqual([
      'https://www.instagram.com/cafe.uno/',
      'https://www.instagram.com/cafe.dos/',
    ])
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      usernames: ['cafe.uno', 'cafe.dos'],
      includeAboutSection: false,
    })
  })

  it('lee el rubro de la cuenta e ignora "None"', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { username: 'living.uy', fullName: 'L I V I N G', businessCategoryName: 'Bar' },
      { username: 'plazadechueca_pde', fullName: 'Plaza de Chueca PdE', businessCategoryName: 'None' },
    ]), { status: 200 }))
    const profiles = await new ApifyInstagramProvider({ token: 'secret' }, fetcher).scrapeMany(['https://www.instagram.com/living.uy/', 'https://www.instagram.com/plazadechueca_pde/'])
    expect(profiles[0].category).toBe('Bar')
    expect(profiles[1]).not.toHaveProperty('category')
  })

  it('timeout, 504, 5xx y error de red son pasajeros; 400 y 402 no', async () => {
    const providerFor = (fetcher: typeof fetch) => new ApifyInstagramProvider({ token: 'secret' }, fetcher)
    const timeout = vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError'))
    await expect(providerFor(timeout).scrape('https://instagram.com/cafe/')).rejects.toMatchObject({ name: 'TransientProviderError', kind: 'timeout' })
    for (const status of [408, 504, 500, 503]) {
      const error = await providerFor(vi.fn().mockResolvedValue(new Response('{}', { status }))).scrape('https://instagram.com/cafe/').catch((caught: unknown) => caught)
      expect(error, String(status)).toBeInstanceOf(TransientProviderError)
    }
    await expect(providerFor(vi.fn().mockRejectedValue(new TypeError('fetch failed'))).scrape('https://instagram.com/cafe/')).rejects.toBeInstanceOf(TransientProviderError)
    for (const status of [400, 402]) {
      const error = await providerFor(vi.fn().mockResolvedValue(new Response('{}', { status }))).scrape('https://instagram.com/cafe/').catch((caught: unknown) => caught)
      expect(error, String(status)).not.toBeInstanceOf(TransientProviderError)
    }
  })

  it('cada corrida espera hasta 120 s y pasa la memoria sólo si es válida', async () => {
    const ok = () => vi.fn().mockResolvedValue(new Response('[]', { status: 200 }))
    const withMemory = ok()
    await new ApifyInstagramProvider({ token: 'secret', memoryMbytes: 512 }, withMemory).scrape('https://instagram.com/cafe/')
    const url = new URL(String(withMemory.mock.calls[0][0]))
    expect(url.searchParams.get('timeout')).toBe('120')
    expect(url.searchParams.get('memory')).toBe('512')

    const withoutMemory = ok()
    await new ApifyInstagramProvider({ token: 'secret' }, withoutMemory).scrape('https://instagram.com/cafe/')
    expect(new URL(String(withoutMemory.mock.calls[0][0])).searchParams.has('memory')).toBe(false)

    const invalid = ok()
    await new ApifyInstagramProvider({ token: 'secret', memoryMbytes: 500 }, invalid).scrape('https://instagram.com/cafe/')
    expect(new URL(String(invalid.mock.calls[0][0])).searchParams.has('memory')).toBe(false)
  })

  it('toma la fecha del post más nuevo, en ISO o en segundos', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { username: 'cordon.beer', latestPosts: [{ caption: 'Viernes', timestamp: '2026-10-15T21:00:00.000Z' }, { caption: 'Jueves', timestamp: '2026-10-01T21:00:00.000Z' }] },
      { username: 'cordonbeer', latestPosts: [{ caption: 'Hola', timestamp: 1704888000 }] },
      { username: 'sinfecha', latestPosts: [{ caption: 'Hola' }] },
    ]), { status: 200 }))
    const profiles = await new ApifyInstagramProvider({ token: 'secret' }, fetcher).scrapeMany(['https://instagram.com/cordon.beer/'])
    expect(profiles.map((profile) => profile.latestPostAt)).toEqual(['2026-10-15T21:00:00.000Z', '2024-01-10T12:00:00.000Z', undefined])
  })
})
