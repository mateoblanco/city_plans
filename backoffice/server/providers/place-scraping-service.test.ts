import { describe, expect, it, vi } from 'vitest'
import { PlacesProviderError } from './places-provider.ts'
import { PlaceScrapingService } from './place-scraping-service.ts'

function details(websiteUri: string | null) {
  return {
    source: 'google' as const,
    exactMatch: true as const,
    anchor: {
      name: 'Café Central',
      address: '18 de Julio 1234',
      latitude: -34.9,
      longitude: -56.16,
    },
    websiteUri,
    data: {},
    attribution: 'Google Maps',
  }
}

describe('PlaceScrapingService', () => {
  it('combina web e Instagram en texto literal y usa caché por placeId', async () => {
    const getDetails = vi.fn().mockResolvedValue(details('https://cafe.example/'))
    const scrapeWebsite = vi.fn().mockResolvedValue({
      url: 'https://cafe.example/',
      title: 'Café Central',
      description: 'Café de especialidad',
      content: 'Vendemos café, pastelería y brunch.',
      instagramUrls: ['https://www.instagram.com/cafe.central/'],
    })
    const scrapeInstagram = vi.fn().mockResolvedValue({
      url: 'https://www.instagram.com/cafe.central/',
      name: 'Café Central',
      bio: 'Montevideo · Todos los días de 9 a 20 h',
      links: ['https://reservas.example/'],
    })
    const service = new PlaceScrapingService({
      details: { getDetails },
      website: { configured: true, scrape: scrapeWebsite },
      instagram: { configured: true, scrape: scrapeInstagram },
    })

    const [first, concurrent] = await Promise.all([
      service.scrape('place-1'),
      service.scrape('place-1'),
    ])
    const cached = await service.scrape('place-1')

    expect(first.scrapedInfo).toContain('SITIO WEB')
    expect(first.scrapedInfo).toContain('Vendemos café, pastelería y brunch.')
    expect(first.scrapedInfo).toContain('INSTAGRAM')
    expect(first.scrapedInfo).toContain('Bio: Montevideo · Todos los días de 9 a 20 h')
    expect(concurrent).toBe(first)
    expect(cached).toBe(first)
    expect(getDetails).toHaveBeenCalledTimes(1)
    expect(scrapeWebsite).toHaveBeenCalledTimes(1)
    expect(scrapeInstagram).toHaveBeenCalledTimes(1)

    await service.scrape('place-1', { refresh: true })
    expect(scrapeWebsite).toHaveBeenCalledTimes(2)
  })

  it('consulta Instagram primero y scrapea su primer link web elegible', async () => {
    const calls: string[] = []
    const scrapeWebsite = vi.fn().mockImplementation(async (url: string) => {
      calls.push(`website:${url}`)
      return {
        url,
        title: 'Café Central',
        description: '',
        content: 'Café de especialidad',
        instagramUrls: [],
      }
    })
    const scrapeInstagram = vi.fn().mockImplementation(async () => {
      calls.push('instagram')
      return {
        url: 'https://www.instagram.com/cafe.central/',
        name: 'Café Central',
        bio: 'Montevideo',
        links: ['https://linktr.ee/cafe-central', 'https://cafe.example/'],
      }
    })
    const service = new PlaceScrapingService({
      details: { getDetails: vi.fn().mockResolvedValue(details('https://instagram.com/cafe.central')) },
      website: { configured: true, scrape: scrapeWebsite },
      instagram: { configured: true, scrape: scrapeInstagram },
    })

    const result = await service.scrape('place-2')

    expect(calls).toEqual(['instagram', 'website:https://cafe.example/'])
    expect(result.website).toMatchObject({
      status: 'success',
      url: 'https://cafe.example/',
      discoveredVia: 'website_link',
    })
    expect(result.instagram.status).toBe('success')
  })

  it('no busca una alternativa cuando Instagram no aporta una web elegible', async () => {
    const search = vi.fn()
    const scrapeWebsite = vi.fn()
    const service = new PlaceScrapingService({
      details: { getDetails: vi.fn().mockResolvedValue(details('https://instagram.com/cafe.central')) },
      website: { configured: true, scrape: scrapeWebsite },
      instagram: {
        configured: true,
        scrape: vi.fn().mockResolvedValue({
          url: 'https://www.instagram.com/cafe.central/',
          name: 'Café Central',
          bio: 'Montevideo',
          links: ['https://linktr.ee/cafe-central', 'https://instagram.com/cafe.central/'],
        }),
      },
      googleSearch: { configured: true, search },
    })

    const result = await service.scrape('place-2-no-web')

    expect(scrapeWebsite).not.toHaveBeenCalled()
    expect(search).not.toHaveBeenCalled()
    expect(result.website).toEqual({ status: 'not_found', url: null })
    expect(result.discovery.googleSearchAttempted).toBe(false)
  })

  it('conserva la web cuando Instagram falla', async () => {
    const service = new PlaceScrapingService({
      details: { getDetails: vi.fn().mockResolvedValue(details('https://cafe.example/')) },
      website: {
        configured: true,
        scrape: vi.fn().mockResolvedValue({
          url: 'https://cafe.example/',
          title: 'Café',
          description: '',
          content: 'Contenido',
          instagramUrls: ['https://www.instagram.com/cafe/'],
        }),
      },
      instagram: {
        configured: false,
        scrape: vi.fn().mockRejectedValue(
          new PlacesProviderError('configuration', 'Falta APIFY_API_TOKEN.'),
        ),
      },
    })

    const result = await service.scrape('place-3')

    expect(result.website.status).toBe('success')
    expect(result.instagram).toMatchObject({
      status: 'error',
      error: { code: 'CONFIGURATION_ERROR' },
    })
    expect(result.scrapedInfo).toContain('Contenido')
  })

  it('devuelve ambas fuentes como no encontradas cuando Google no informa web', async () => {
    const service = new PlaceScrapingService({
      details: { getDetails: vi.fn().mockResolvedValue(details(null)) },
      website: { configured: true, scrape: vi.fn() },
      instagram: { configured: true, scrape: vi.fn() },
    })

    const result = await service.scrape('place-4')

    expect(result.scrapedInfo).toBe('')
    expect(result.website.status).toBe('not_found')
    expect(result.instagram.status).toBe('not_found')
  })

  it('no busca en Google cuando la web ya enlaza un Instagram válido', async () => {
    const search = vi.fn()
    const service = new PlaceScrapingService({
      details: { getDetails: vi.fn().mockResolvedValue(details('https://cafe.example/')) },
      website: {
        configured: true,
        scrape: vi.fn().mockResolvedValue({
          url: 'https://cafe.example/',
          title: 'Café Central',
          description: '',
          content: '18 de Julio 1234, Montevideo',
          instagramUrls: ['https://www.instagram.com/cafe.central/'],
        }),
      },
      instagram: {
        configured: true,
        scrape: vi.fn().mockResolvedValue({
          url: 'https://www.instagram.com/cafe.central/',
          name: 'Café Central',
          bio: 'Montevideo',
          links: ['https://cafe.example/'],
        }),
      },
      googleSearch: { configured: true, search },
    })

    const result = await service.scrape('complete')

    expect(search).not.toHaveBeenCalled()
    expect(result.discovery.googleSearchAttempted).toBe(false)
    expect(result.website.discoveredVia).toBe('google_places')
    expect(result.instagram.discoveredVia).toBe('website_link')
  })

  it('busca solamente Instagram cuando ya tiene la web', async () => {
    const search = vi.fn().mockResolvedValue([{
      url: 'https://instagram.com/cafe.central/',
      title: 'Café Central (@cafe.central) • Instagram',
      description: '18 de Julio 1234, Montevideo',
      position: 1,
    }])
    const scrapeMany = vi.fn().mockResolvedValue([{
      url: 'https://www.instagram.com/cafe.central/',
      name: 'Café Central',
      bio: '18 de Julio 1234, Montevideo',
      links: ['https://cafe.example/'],
    }])
    const service = new PlaceScrapingService({
      details: { getDetails: vi.fn().mockResolvedValue(details('https://cafe.example/')) },
      website: {
        configured: true,
        scrape: vi.fn().mockResolvedValue({
          url: 'https://cafe.example/',
          title: 'Café Central',
          description: '',
          content: 'Café de especialidad',
          instagramUrls: [],
        }),
      },
      instagram: { configured: true, scrape: vi.fn(), scrapeMany },
      googleSearch: { configured: true, search },
    })

    const result = await service.scrape('web-only')

    expect(search).toHaveBeenCalledTimes(1)
    expect(search.mock.calls[0][0]).toBe('Café Central')
    expect(scrapeMany).toHaveBeenCalledWith(['https://www.instagram.com/cafe.central/'])
    expect(result.instagram).toMatchObject({
      status: 'success',
      discoveredVia: 'google_search',
    })
  })

  it('amplía la búsqueda de Instagram sólo cuando el nombre no devuelve perfiles', async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce([{
        url: 'https://www.instagram.com/vitibardevinos/',
        title: 'Viti Bar de Vinos',
        description: 'Una vermutería en Montevideo',
        position: 1,
      }])
      .mockResolvedValueOnce([{
        url: 'https://www.instagram.com/vermuteria.flores/',
        title: 'Vermutería Flores • Instagram',
        description: 'Miñones 455, Montevideo',
        position: 1,
      }])
    const service = new PlaceScrapingService({
      details: {
        getDetails: vi.fn().mockResolvedValue({
          ...details('https://vermuteria.example/'),
          anchor: {
            ...details(null).anchor,
            name: 'Vermutería',
            address: 'Miñones 455, Montevideo',
          },
        }),
      },
      website: {
        configured: true,
        scrape: vi.fn().mockResolvedValue({
          url: 'https://vermuteria.example/',
          title: 'Vermutería',
          description: '',
          content: 'Miñones 455, Montevideo',
          instagramUrls: [],
        }),
      },
      instagram: {
        configured: true,
        scrape: vi.fn(),
        scrapeMany: vi
          .fn()
          .mockResolvedValueOnce([{
            url: 'https://www.instagram.com/vitibardevinos/',
            name: 'Viti Bar de Vinos',
            bio: 'Colón 1543, Montevideo',
            links: [],
          }])
          .mockResolvedValueOnce([{
            url: 'https://www.instagram.com/vermuteria.flores/',
            name: 'Vermutería Flores',
            bio: 'Miñones 455, Montevideo',
            links: [],
          }]),
      },
      googleSearch: { configured: true, search },
    })

    const result = await service.scrape('instagram-fallback')

    expect(search.mock.calls.map(([query]) => query)).toEqual([
      'Vermutería',
      'Vermutería Montevideo Uruguay',
    ])
    expect(result.instagram).toMatchObject({
      status: 'success',
      url: 'https://www.instagram.com/vermuteria.flores/',
    })
  })

  it('no sigue el Instagram de una nota confundida con la web oficial', async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce([{
        url: 'https://www.wineriesofuruguay.com/agenda/2026-06',
        title: 'Agenda',
        description: 'La Vermutería invita en Miñones 455, Montevideo.',
        position: 1,
      }])
      .mockResolvedValueOnce([{
        url: 'https://www.instagram.com/vermuteria.flores/',
        title: 'Vermutería Flores • Instagram',
        description: 'Miñones 455, Montevideo',
        position: 1,
      }])
    const scrapeInstagram = vi.fn()
    const service = new PlaceScrapingService({
      details: {
        getDetails: vi.fn().mockResolvedValue({
          ...details(null),
          anchor: {
            ...details(null).anchor,
            name: 'Vermutería',
            address: 'Miñones 455, Montevideo',
          },
        }),
      },
      website: {
        configured: true,
        validateUrl: vi.fn((url: string) => Promise.resolve(url)),
        scrape: vi.fn().mockResolvedValue({
          url: 'https://www.wineriesofuruguay.com/agenda/2026-06',
          title: 'Agenda de junio',
          description: 'Eventos y novedades',
          content: 'La Vermutería invita en Miñones 455, Montevideo.',
          instagramUrls: ['https://www.instagram.com/vitibardevinos/'],
        }),
      },
      instagram: {
        configured: true,
        scrape: scrapeInstagram,
        scrapeMany: vi.fn().mockResolvedValue([{
          url: 'https://www.instagram.com/vermuteria.flores/',
          name: 'Vermutería Flores',
          bio: 'Miñones 455, Montevideo',
          links: [],
        }]),
      },
      googleSearch: { configured: true, search },
    })

    const result = await service.scrape('vermuteria-regression')

    expect(scrapeInstagram).not.toHaveBeenCalledWith(
      'https://www.instagram.com/vitibardevinos/',
    )
    expect(result.website.status).toBe('not_found')
    expect(result.discovery.websiteCandidates).toHaveLength(1)
    expect(result.instagram).toMatchObject({
      status: 'success',
      url: 'https://www.instagram.com/vermuteria.flores/',
    })
  })

  it('no usa Google Search cuando Google Places apunta a Instagram', async () => {
    const search = vi.fn()
    const scrapeWebsite = vi.fn().mockResolvedValue({
      url: 'https://cafe.example/',
      title: 'Café Central',
      description: '18 de Julio 1234, Montevideo',
      content: 'Café de especialidad',
      instagramUrls: ['https://www.instagram.com/cafe.central/'],
    })
    const service = new PlaceScrapingService({
      details: {
        getDetails: vi.fn().mockResolvedValue(
          details('https://instagram.com/cafe.central/'),
        ),
      },
      website: {
        configured: true,
        validateUrl: vi.fn((url: string) => Promise.resolve(url)),
        scrape: scrapeWebsite,
      },
      instagram: {
        configured: true,
        scrape: vi.fn().mockResolvedValue({
          url: 'https://www.instagram.com/cafe.central/',
          name: 'Café Central',
          bio: '18 de Julio 1234, Montevideo',
          links: ['https://cafe.example/'],
        }),
      },
      googleSearch: { configured: true, search },
    })

    const result = await service.scrape('instagram-only')

    expect(search).not.toHaveBeenCalled()
    expect(scrapeWebsite).toHaveBeenCalledWith('https://cafe.example/')
    expect(result.website).toMatchObject({
      status: 'success',
      discoveredVia: 'website_link',
    })
  })

  it('busca primero la web y evita otra búsqueda si ésta enlaza Instagram', async () => {
    const search = vi.fn().mockResolvedValue([{
      url: 'https://cafe.example/',
      title: 'Café Central',
      description: '18 de Julio 1234, Montevideo',
      position: 1,
    }])
    const scrapeInstagram = vi.fn().mockResolvedValue({
      url: 'https://www.instagram.com/cafe.central/',
      name: 'Café Central',
      bio: 'Montevideo',
      links: [],
    })
    const service = new PlaceScrapingService({
      details: { getDetails: vi.fn().mockResolvedValue(details(null)) },
      website: {
        configured: true,
        validateUrl: vi.fn((url: string) => Promise.resolve(url)),
        scrape: vi.fn().mockResolvedValue({
          url: 'https://cafe.example/',
          title: 'Café Central',
          description: '',
          content: 'Estamos en 18 de Julio 1234, Montevideo.',
          instagramUrls: ['https://www.instagram.com/cafe.central/'],
        }),
      },
      instagram: { configured: true, scrape: scrapeInstagram },
      googleSearch: { configured: true, search },
    })

    const result = await service.scrape('missing-both')

    expect(search).toHaveBeenCalledTimes(1)
    expect(scrapeInstagram).toHaveBeenCalledWith('https://www.instagram.com/cafe.central/')
    expect(result.website.discoveredVia).toBe('google_search')
    expect(result.instagram.discoveredVia).toBe('website_link')
  })

  it('expone candidatos ambiguos y permite seleccionar sólo uno cacheado', async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce([{
        url: 'https://candidate.example/',
        title: 'Café Central',
        description: 'Café de especialidad',
        position: 1,
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const scrapeWebsite = vi.fn().mockResolvedValue({
      url: 'https://candidate.example/',
      title: 'Café Central',
      description: 'Café de especialidad',
      content: 'Brunch y pastelería artesanal.',
      instagramUrls: [],
    })
    const service = new PlaceScrapingService({
      details: { getDetails: vi.fn().mockResolvedValue(details(null)) },
      website: {
        configured: true,
        validateUrl: vi.fn((url: string) => Promise.resolve(url)),
        scrape: scrapeWebsite,
      },
      instagram: { configured: true, scrape: vi.fn(), scrapeMany: vi.fn() },
      googleSearch: { configured: true, search },
    })

    const initial = await service.scrape('ambiguous')

    expect(initial.website.status).toBe('not_found')
    expect(initial.scrapedInfo).toBe('')
    expect(initial.discovery.websiteCandidates).toHaveLength(1)
    expect(initial.discovery.websiteCandidates[0]).toMatchObject({
      url: 'https://candidate.example/',
      confidence: 'medium',
    })

    await expect(service.scrape('ambiguous', {
      selectedCandidate: { kind: 'website', url: 'https://evil.example/' },
    })).rejects.toMatchObject({ kind: 'validation' })

    const selected = await service.scrape('ambiguous', {
      selectedCandidate: {
        kind: 'website',
        url: 'https://candidate.example/',
      },
    })
    expect(selected.website).toMatchObject({
      status: 'success',
      discoveredVia: 'user_selected',
    })
    expect(selected.discovery.websiteCandidates).toEqual([])
    expect(selected.scrapedInfo).toContain('Brunch y pastelería artesanal.')
    expect(scrapeWebsite).toHaveBeenCalledTimes(2)
  })

  it('conserva fuentes confirmadas cuando el fallback de Google falla', async () => {
    const service = new PlaceScrapingService({
      details: { getDetails: vi.fn().mockResolvedValue(details('https://cafe.example/')) },
      website: {
        configured: true,
        scrape: vi.fn().mockResolvedValue({
          url: 'https://cafe.example/',
          title: 'Café Central',
          description: '',
          content: 'Contenido confirmado',
          instagramUrls: [],
        }),
      },
      instagram: { configured: true, scrape: vi.fn() },
      googleSearch: {
        configured: true,
        search: vi.fn().mockRejectedValue(
          new PlacesProviderError('quota', 'Apify no tiene crédito disponible.'),
        ),
      },
    })

    const result = await service.scrape('partial-google')

    expect(result.website.status).toBe('success')
    expect(result.instagram).toMatchObject({
      status: 'error',
      error: { code: 'QUOTA_ERROR' },
    })
    expect(result.scrapedInfo).toContain('Contenido confirmado')
  })

  it('valida una pista de Instagram de Exa, conserva captions y rechaza perfiles extranjeros', async () => {
    const scrapeMany = vi.fn()
      .mockResolvedValueOnce([{
        url: 'https://www.instagram.com/cafe.central/',
        name: 'Café Central',
        bio: '18 de Julio 1234, Montevideo, Uruguay',
        links: ['https://cafe.example/'],
        posts: ['Brunch este sábado en Montevideo'],
      }])
      .mockResolvedValueOnce([{
        url: 'https://www.instagram.com/cafe.central.br/',
        name: 'Café Central',
        bio: 'São Paulo, Brasil',
        links: [],
      }])
    const service = new PlaceScrapingService({
      details: { getDetails: vi.fn().mockResolvedValue(details('https://cafe.example/')) },
      website: {
        configured: true,
        scrape: vi.fn().mockResolvedValue({
          url: 'https://cafe.example/', title: 'Café Central', description: '',
          content: '18 de Julio 1234, Montevideo', instagramUrls: [], links: [],
        }),
      },
      instagram: { configured: true, scrape: vi.fn(), scrapeMany },
    })

    await service.scrape('exa-instagram')
    const accepted = await service.enrichFromHints('exa-instagram', {
      websiteUrls: [], instagramUrls: ['https://www.instagram.com/cafe.central/'],
    })
    expect(accepted.instagram).toMatchObject({ status: 'success', url: 'https://www.instagram.com/cafe.central/', posts: ['Brunch este sábado en Montevideo'] })

    await service.scrape('exa-instagram-foreign')
    const foreign = await service.enrichFromHints('exa-instagram-foreign', {
      websiteUrls: [], instagramUrls: ['https://www.instagram.com/cafe.central.br/'],
    })
    expect(foreign.instagram.status).toBe('not_found')
    expect(foreign.discovery.instagramHintReview).toBe('location_mismatch')
  })
})
