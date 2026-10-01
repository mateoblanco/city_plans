import { describe, expect, it, vi } from 'vitest'
import { ApifyInstagramProvider } from './apify-instagram-provider.ts'

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
      .rejects.toMatchObject({ kind: 'quota' })
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
})
