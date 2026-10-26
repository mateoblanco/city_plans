import { APICallError } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { getNeighborhood } from '../../src/lib/getNeighborhood.ts'
import {
  PlaceExtractionService,
  filterSources,
  classifyContact,
  classifySource,
  deduplicateSourceText,
  extractionModelConfig,
  cuisineMentioned,
  cuisineSupport,
  supportedCuisines,
  dishSupportedBy,
  isChainBranch,
  postProcess,
  signatureAllowed,
  providerOptionsFor,
  reviewExtraction,
  slotsFromBlocks,
  instagramHandlesFromResults,
  exaProfileCandidate,
  instagramProfileMatch,
  instagramDiscoverySummary,
  instagramRejectedByModel,
  brandHandleMatch,
  hasGastronomyCategory,
  isForeignSource,
  resolveDeterministicContact,
  isListingSource,
  phonesInText,
  placeText,
  SYSTEM_PROMPT,
  HOURS_RETRY_PROMPT,
  hoursModelConfig,
  llmUsageCost,
  mainExtractionRequest,
  mentionsAddress,
  MISSING_NAME_DOUBT,
  officialWebsiteHome,
  PlaceExtraction,
  type Source,
} from './place-extraction-service.ts'
import { groupOf } from '../../src/data/tags.ts'
import { EXA_SUMMARY_URL } from './source-hosts.ts'
import { RateLimitError, TransientProviderError } from './rate-limit.ts'
import { DiscoveryExpired, ExaProviderFailure, InstagramNotFound, InstagramProviderFailure, PlacesProviderError } from './places-provider.ts'
import { DISCOVERY_TTL_MS, DiscoveryStore } from './discovery-store.ts'
import type { ExtractionSnapshot } from './extraction-snapshots.ts'
import { CANDIDATE_TTL_MS, InstagramCandidateRegistry, type InstagramOwners } from './instagram-candidate-registry.ts'
import { ICON_CATEGORIES, ICON_CATEGORY_KEYS } from '../../src/data/icon-categories.ts'
import type { LogoClassifier } from './place-logo.ts'

const target = {
  name: 'Café Brasilero',
  address: 'Ituzaingó 1447',
  coordinates: { lat: -34.906, lng: -56.202, source: 'google' as const, fetchedAt: '2026-10-01T00:00:00.000Z' },
  neighborhoodId: 'CIUDAD VIEJA',
  city: 'Montevideo' as const,
  googlePlaceId: 'place-1',
  transit: { status: 'success' as const, lines: [] },
}

const extraction: PlaceExtraction = {
  facts: [{ id: 'F1', text: 'sirve desayunos', sourceId: 'S1', kind: 'food', proposedTag: null }],
  tags: [
    { group: 'categories', id: 'cafe', facts: ['F1'] }, { group: 'moments', id: 'breakfast', facts: ['F1'] }, { group: 'foods', id: 'pastries', facts: ['F1'] },
    { group: 'drinks', id: 'specialty_coffee', facts: ['F1'] }, { group: 'features', id: 'wifi', facts: ['F1'] }, { group: 'goodFor', id: 'work', facts: ['F1'] },
  ],
  dietary: { vegan: 'unknown', vegetarian: 'has_options', glutenFree: 'unknown' },
  price: 'moderate', reservations: 'unknown',
  hours: { raw: 'Lunes 08:00 a 19:00', display: null, blocks: [{ days: [1], opens: '08:00', closes: '19:00' }] },
  contact: { instagram: 'cafebrasilero', website: 'https://cafe.example/' },
  highlights: [{ es: 'flat white', en: 'flat white', facts: ['F1'] }],
  dishes: [],
  signature: [],
  description: { es: 'Un café histórico para hacer una pausa.', en: 'A historic café for a relaxed break.' },
  name: '',
  locatedIn: null,
  support: [],
  doubts: [],
  iconCategory: 'coffee',
}

// Extracción vacía del modelo: cada test agrega sólo lo que necesita.
const emptyExtraction: PlaceExtraction = {
  ...extraction,
  facts: [], tags: [], highlights: [],
  hours: { raw: null, display: null, blocks: [] }, support: [],
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function exaResponse(instagram = '', results: { title: string; url: string; highlights: string[] }[] = []) {
  return {
    source: 'exa' as const,
    query: `${target.name}, Montevideo, Uruguay`,
    output: {
      content: {
        description: '',
        address: target.address,
        contact_info: instagram ? `Instagram: ${instagram}` : '',
        open_hours_raw: '', open_hours: [],
        knows_before_you_go: '',
        menu: [],
      },
      grounding: {},
    },
    results,
    requestId: 'exa-1',
    attribution: 'Exa',
  }
}

const googleDetails = {
  source: 'google' as const,
  exactMatch: true as const,
  anchor: {
    name: target.name,
    address: target.address,
    latitude: target.coordinates.lat,
    longitude: target.coordinates.lng,
  },
  websiteUri: null,
  data: {},
  attribution: 'Google Maps',
}

describe('PlaceExtractionService', () => {
  it('filtra fuentes bloqueadas y produce el borrador', () => {
    expect(filterSources([
      { id: 'S1', kind: 'web', url: 'https://cafe.example/', text: 'Café de especialidad' },
      { id: 'S2', kind: 'web', url: 'https://www.google.com/maps', text: 'No usar' },
    ])).toHaveLength(1)

    const place = postProcess(target, {
      ...extraction,
      facts: [{ id: 'F1', text: 'es un café de especialidad', sourceId: 'S1', kind: 'other', proposedTag: null }],
      tags: [{ group: 'categories', id: 'cafe', facts: ['F1'] }],
    }, { sources: [{ id: 'S1', kind: 'web', trust: 'official', url: 'https://cafe.example/', text: 'Café de especialidad' }] })

    expect(place.neighborhoodId).toBe('CIUDAD VIEJA')
    expect(place.coordinates).toEqual({ lat: -34.906, lng: -56.202, source: 'google', fetchedAt: '2026-10-01T00:00:00.000Z' })
    expect(place.categories).toEqual(['cafe'])
    expect(place).not.toHaveProperty('provenance')
    expect(place.embeddingText).not.toContain('coffee shop')
    expect(place.keywordText).toContain('coffee shop')
  })

  describe('429', () => {
    const limited = () => new APICallError({ message: 'Too Many Requests', url: 'https://ai-gateway.example/v1', requestBodyValues: {}, statusCode: 429 })
    const fastRetry = { sleep: async () => {}, random: () => 1 }
    const withWebsite = { ...googleDetails, websiteUri: 'https://cafe.example/' }
    const website = { configured: true as const, scrape: async (url: string) => ({ url, title: target.name, description: '', content: 'Café de especialidad. Lunes 08:00 a 19:00', instagramUrls: [] }) }
    const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {})

    it('un 429 del LLM se reintenta: el lugar sale ok y el motivo queda en review.rateLimits', async () => {
      quiet()
      const generate = vi.fn().mockRejectedValueOnce(limited()).mockResolvedValueOnce(extraction)
      const service = new PlaceExtractionService({
        apiKey: 'test-key', details: { getDetails: async () => withWebsite }, website, generate, rateLimitRetry: fastRetry,
        exa: { configured: true, searchPlace: async () => exaResponse() },
      })

      const result = await service.extract('place-1', { seedCategories: ['cafe'] })

      expect(result.status).toBe('ok')
      expect(generate).toHaveBeenCalledTimes(2)
      expect(result.status === 'ok' && result.review.rateLimits).toEqual([{ service: 'llm', retries: 1, waitedMs: 1000, recovered: true }])
      vi.restoreAllMocks()
    })

    it('Exa con 429 que no se recupera: agotados los reintentos, el lugar termina con ExaProviderFailure', async () => {
      quiet()
      const searchPlace = vi.fn().mockRejectedValue(new RateLimitError('exa', 'Exa limitó temporalmente las consultas.'))
      const generate = vi.fn(async () => extraction)
      const service = new PlaceExtractionService({
        apiKey: 'test-key', details: { getDetails: async () => withWebsite }, website,
        exa: { configured: true, searchPlace },
        generate,
        rateLimitRetry: fastRetry,
      })

      const failure = await service.extract('place-1', { seedCategories: ['cafe'] }).catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(ExaProviderFailure)
      expect(searchPlace).toHaveBeenCalledTimes(4)
      expect(generate).not.toHaveBeenCalled()
      vi.restoreAllMocks()
    })

    it('un 429 permanente del LLM termina en quota con los intentos en el mensaje', async () => {
      quiet()
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const generate = vi.fn().mockRejectedValue(limited())
      const service = new PlaceExtractionService({
        apiKey: 'test-key', details: { getDetails: async () => withWebsite }, website, generate, rateLimitRetry: fastRetry,
        exa: { configured: true, searchPlace: async () => exaResponse() },
      })

      await expect(service.extract('place-1', { seedCategories: ['cafe'] })).rejects.toMatchObject({
        kind: 'quota', message: 'Vercel AI Gateway limitó las consultas (4 intentos).',
      })
      expect(generate).toHaveBeenCalledTimes(4)
      expect(error).toHaveBeenCalled()
      vi.restoreAllMocks()
    })
  })

  it('incluye Exa aunque no haya fuentes web o Instagram', async () => {
    let generated = false
    let sourceKinds: string[] = []
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => ({ source: 'google', exactMatch: true, anchor: { name: target.name, address: target.address, latitude: target.coordinates.lat, longitude: target.coordinates.lng }, websiteUri: null, data: {}, attribution: 'Google Maps' }) },
      exa: { configured: true, searchPlace: async () => ({ source: 'exa', query: 'Café Brasilero, Montevideo, Uruguay', output: { content: { description: '', address: target.address, contact_info: '', open_hours_raw: '', open_hours: [], knows_before_you_go: '', menu: [] }, grounding: {} }, results: [{ title: target.name, url: 'https://cafe.example/', highlights: ['Café Brasilero'] }], requestId: 'exa-1', attribution: 'Exa' }) },
      generate: async (_target, sources) => { generated = true; sourceKinds = sources.map((source) => source.kind); return extraction },
    })

    const result = await service.extract('place-1', { seedCategories: ['cafe'] })
    expect(result.status).toBe('ok')
    expect(generated).toBe(true)
    expect(sourceKinds).toEqual(['exa', 'exa'])
    // La salida cruda del modelo vuelve en el review, para re-correr postProcess sin el LLM.
    expect(result.status === 'ok' && result.review.llmOutput).toEqual(extraction)
    expect(result.sourceAudit).toEqual({
      google: true, exa: true, instagram: false, instagramCandidates: [],
      instagramSelection: { handle: null, origin: null, candidates: [] },
    })
  })

  it('suma el barrio del request a la búsqueda principal de Exa si la marca es corta, no a la de Instagram', async () => {
    const searchPlace = vi.fn(async () => exaResponse())
    const searchText = vi.fn(async (query: string) => ({ query, results: [], requestId: 'exa-ig' }))
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => ({ ...googleDetails, anchor: { ...googleDetails.anchor, name: 'MOB' }, placeType: 'Restaurante' }) },
      exa: { configured: true, searchPlace, searchText },
      generate: async () => extraction,
    })

    await service.collectSources('place-1', { seedCategories: ['restaurant'], neighborhoodId: 'POCITOS' })

    expect(searchPlace).toHaveBeenCalledWith('MOB restaurante Pocitos')
    expect(searchText).toHaveBeenCalledWith('MOB restaurante Montevideo instagram')
  })

  it('busca las fuentes de una sucursal con la marca y toma de Exa la web de la marca si Google no la tiene', async () => {
    const searchPlace = vi.fn(async () => exaResponse('@lanuevaroma', [
      { title: 'La Nueva Roma', url: 'https://guia.example/la-nueva-roma', highlights: ['La Nueva Roma'] },
      { title: 'Sabores', url: 'https://www.lanuevaroma.example/sabores', highlights: ['Sabores de La Nueva Roma'] },
    ]))
    const scrape = vi.fn(async (url: string) => ({ url, title: 'La Nueva Roma', description: '', content: 'Helados artesanales', instagramUrls: [] }))
    // El perfil de la marca no lleva el barrio de la sucursal ni su dirección.
    const scrapeMany = vi.fn(async () => [{ url: 'https://www.instagram.com/lanuevaroma/', name: 'La Nueva Roma', bio: 'Helados artesanales', links: ['https://www.lanuevaroma.example/'] }])
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => ({ ...googleDetails, anchor: { ...googleDetails.anchor, name: 'La Nueva Roma Cordón' } }) },
      exa: { configured: true, searchPlace },
      instagram: { configured: true, scrapeMany },
      website: { configured: true, scrape },
      generate: async () => extraction,
    })

    const collected = await service.collectSources('place-1', { seedCategories: ['ice_cream_shop'] })

    expect(searchPlace).toHaveBeenCalledWith('La Nueva Roma')
    expect(scrape).toHaveBeenCalledWith('https://www.lanuevaroma.example/')
    expect(collected.sources.filter((source) => source.trust === 'official').map((source) => source.url))
      .toEqual(['https://www.lanuevaroma.example/', 'https://www.instagram.com/lanuevaroma/'])
    expect(collected.deterministicContact.instagram).toBe('lanuevaroma')
  })

  it('encuentra el Instagram por los links de la web y la web por los links del Instagram', async () => {
    const profile = { url: 'https://www.instagram.com/marca.uy/', name: 'Heladería Marca', bio: 'Montevideo, Uruguay', links: ['https://heladeriamarca.example/'] }
    const page = (url: string) => ({ url, title: 'Heladería Marca', description: '', content: 'Helados', instagramUrls: [], links: ['https://www.instagram.com/marca.uy/'] })
    const build = (exaInstagram = '', results: { title: string; url: string; highlights: string[] }[] = []) => {
      const scrape = vi.fn(async (url: string) => page(url))
      const scrapeMany = vi.fn(async () => [profile])
      const service = new PlaceExtractionService({
        apiKey: 'test-key',
        details: { getDetails: async () => ({ ...googleDetails, anchor: { ...googleDetails.anchor, name: 'Heladería Marca' } }) },
        exa: { configured: true, searchPlace: async () => exaResponse(exaInstagram, results) },
        instagram: { configured: true, scrapeMany },
        website: { configured: true, scrape },
        generate: async () => extraction,
      })
      return { service, scrape, scrapeMany }
    }

    // La web que trae Exa: su link propone el Instagram.
    const fromWeb = build('', [{ title: 'Heladería Marca', url: 'https://heladeriamarca.example/sabores', highlights: [] }])
    await fromWeb.service.collectSources('place-1', { seedCategories: ['ice_cream_shop'] })
    expect(fromWeb.scrape).toHaveBeenCalledWith('https://heladeriamarca.example/')
    expect(fromWeb.scrapeMany).toHaveBeenCalledWith(['https://www.instagram.com/marca.uy/'])

    // Sin web: el Instagram validado (por un candidato de Exa) lleva a la web de la marca.
    const fromInstagram = build('@marca.uy')
    const collected = await fromInstagram.service.collectSources('place-1', { seedCategories: ['ice_cream_shop'] })
    expect(fromInstagram.scrape).toHaveBeenCalledWith('https://heladeriamarca.example/')
    expect(collected.sources.filter((source) => source.trust === 'official').map((source) => source.kind)).toEqual(['web', 'instagram'])
  })

  it('la web de Google no es fuente: no se scrapea ni propone Instagram, sólo confirma lo que trae otra fuente', async () => {
    const scrape = vi.fn(async (url: string) => ({ url, title: 'Bar', description: '', content: 'Bar', instagramUrls: [] }))
    const scrapeMany = vi.fn(async (urls: string[]) => urls.map((url) => ({ url, name: 'Otro Nombre', bio: '', links: [] })))
    const build = (websiteUri: string, results: { title: string; url: string; highlights: string[] }[] = [], exaInstagram = '') => new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => ({ ...googleDetails, websiteUri }) },
      exa: { configured: true, searchPlace: async () => exaResponse(exaInstagram, results) },
      instagram: { configured: true, scrapeMany },
      website: { configured: true, scrape },
      generate: async () => extraction,
    })

    // Sólo en Google: ni se scrapea la web ni el Instagram es candidato.
    const onlyGoogle = await build('https://www.instagram.com/brasilerouy/').collectSources('place-1', { seedCategories: ['cafe'] })
    await build('https://brasilero.example/').collectSources('place-1', { seedCategories: ['cafe'] })
    expect(scrape).not.toHaveBeenCalled()
    expect(scrapeMany).not.toHaveBeenCalled()
    expect(onlyGoogle.instagramCandidates).toEqual([])

    // Una web de Exa sin la marca en el dominio sólo vale si coincide con la de Google.
    const results = [{ title: 'Café', url: 'https://brasilero.example/menu', highlights: [] }]
    await build('https://brasilero.example/', results).collectSources('place-1', { seedCategories: ['cafe'] })
    expect(scrape).toHaveBeenCalledWith('https://brasilero.example/')
    scrape.mockClear()
    await build('https://otra.example/', results).collectSources('place-1', { seedCategories: ['cafe'] })
    expect(scrape).not.toHaveBeenCalled()

    // Un candidato de Exa que es el Instagram que Google tiene para el lugar se acepta aunque nada más lo identifique.
    const confirmed = await build('https://www.instagram.com/brasilerouy/', [], '@brasilerouy').collectSources('place-1', { seedCategories: ['cafe'] })
    expect(confirmed.instagramValidation.candidates).toEqual([
      { handle: 'brasilerouy', decision: 'selected', reason: 'validated_exact_place_profile', rule: 'google_website_match', origins: ['exa_contact_info'] },
    ])
  })

  it('saca handles de la búsqueda dirigida: instagram.com, agregadores y links en el texto, nunca archivos', () => {
    expect(instagramHandlesFromResults([
      { url: 'https://viralist.ai/instagram/creators/oriundo.uy', highlights: [] },
      { url: 'https://www.instagram.com/el.mingus/', highlights: [] },
      { url: 'https://guia.example/bar', highlights: ['Seguilos en instagram.com/barmarca'] },
      { url: 'https://www.instagram.com/entradas.html', highlights: [] },
      { url: 'https://guia.example/otro', highlights: ['Sin redes'] },
    ])).toEqual(['oriundo.uy', 'el.mingus', 'barmarca'])
  })

  it('propone y valida el Instagram con @handles sin etiqueta, la búsqueda dirigida y la dirección en la bio', async () => {
    const scrapeMany = vi.fn(async (urls: string[]) => urls.map((url) => url.includes('sumi')
      // Nombre corto ("SUMI" para "Sumi Sushi") sin Montevideo, pero con la dirección del local en la bio.
      ? { url, name: 'SUMI', bio: '19 años en el mismo lugar 📍PATRIA 699', links: [] }
      // Misma dirección y otro nombre: no es el perfil del local.
      : { url, name: 'Peluquería Vecina', bio: 'Patria 699', links: [] }))
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => ({ ...googleDetails, anchor: { ...googleDetails.anchor, name: 'Sumi Sushi', address: 'Patria 699, 11300 Montevideo' } }) },
      exa: {
        configured: true,
        searchPlace: async () => ({ ...exaResponse(), output: { ...exaResponse().output, content: { ...exaResponse().output.content, contact_info: 'Email: @sumi_japanese_food' } } }),
        searchText: async (query: string) => ({ query, results: [{ title: 'peluqueria.vecina', url: 'https://viralist.ai/instagram/creators/peluqueria.vecina', highlights: [] }], requestId: 'r' }),
      },
      instagram: { configured: true, scrapeMany },
      generate: async () => extraction,
    })

    const collected = await service.collectSources('place-1', { seedCategories: ['restaurant'] })

    expect(scrapeMany).toHaveBeenCalledWith(['https://www.instagram.com/sumi_japanese_food/', 'https://www.instagram.com/peluqueria.vecina/'])
    expect(collected.instagramValidation.profile?.url).toBe('https://www.instagram.com/sumi_japanese_food/')
  })

  it('el snapshot guarda la auditoría del Instagram, y el rechazo del modelo saca el contacto aunque Apify lo validó', async () => {
    const saved: ExtractionSnapshot[] = []
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => googleDetails },
      exa: { configured: true, searchPlace: async () => exaResponse('@cafebrasilero') },
      instagram: { configured: true, scrapeMany: async () => [{ url: 'https://www.instagram.com/cafebrasilero/', name: target.name, bio: 'Montevideo, Uruguay', links: [] }] },
      generate: async () => ({ ...extraction, contact: { ...extraction.contact, instagram: '' }, doubts: ['Instagram rechazado: es de otro negocio con el mismo nombre.'] }),
      snapshots: { save: async (snapshot) => { saved.push(snapshot) } },
    })

    const result = await service.extract('place-1', { seedCategories: ['cafe'] })

    if (result.status !== 'ok') throw new Error('se esperaba ok')
    expect(result.place.contact.instagram).toBeNull()
    expect(saved[0].instagramAudit).toMatchObject({
      validated: 'cafebrasilero', modelRejected: true, saved: null,
      candidates: [{ handle: 'cafebrasilero', decision: 'selected', rule: 'handle_exact', origins: ['exa_contact_info'] }],
    })
  })

  it('El Sótano: marca + sufijo no alcanza si el perfil es de otro rubro o publica otra dirección', () => {
    const sotano = { ...googleDetails, anchor: { ...googleDetails.anchor, name: 'El Sótano', address: 'Juan D. Jackson 1351, 11300 Montevideo' }, phoneNumber: '2407 5593' }
    const barber = {
      url: 'https://www.instagram.com/elsotano.uy/', name: 'Barberia El Sótano ⚜️', links: ['http://www.elsotano.com.uy/'],
      bio: 'Te esperamos en Isla de flores 1925 esquina Jackson 📍 Lunes a viernes de 10:00 hs a 19:00 hs',
    }
    expect(instagramProfileMatch(sotano, barber, null)).toEqual({ accepted: false, rule: 'non_gastronomy_profile' })
    expect(instagramProfileMatch(sotano, { ...barber, name: 'El Sótano' }, null)).toEqual({ accepted: false, rule: 'other_address_in_bio' })
    // El teléfono del local en la bio sí alcanza.
    expect(instagramProfileMatch(sotano, { ...barber, bio: `${barber.bio} Tel 2407 5593` }, null)).toEqual({ accepted: true, rule: 'mismatch_overridden_by_phone' })
    // El bar real: nombre y dirección; y un handle de marca sin conflictos sigue alcanzando solo.
    const bar = { url: 'https://www.instagram.com/elsotano18/', name: 'El Sótano', bio: 'Pizza & Beer · Jackson 1351 esquina Chaná 📍', links: [] }
    expect(instagramProfileMatch(sotano, bar, null)).toEqual({ accepted: true, rule: 'name_and_address' })
    expect(instagramProfileMatch(sotano, { ...bar, url: 'https://www.instagram.com/elsotano.uy/', bio: 'Pub' }, null)).toEqual({ accepted: true, rule: 'handle_location' })
    // Un año en la bio no es una dirección.
    expect(instagramProfileMatch(sotano, { ...bar, url: 'https://www.instagram.com/elsotano.uy/', bio: 'Bar desde 1995 · 📍 Cordón' }, null)).toEqual({ accepted: true, rule: 'handle_location' })
  })

  it('cada candidato guarda de dónde salió y qué regla lo aceptó o rechazó', async () => {
    const scrapeMany = vi.fn(async (urls: string[]) => urls.map((url) => url.includes('cafebrasilero')
      ? { url, name: target.name, bio: 'Montevideo, Uruguay', links: [] }
      : { url, name: 'Otra Cosa', bio: '', links: [] }))
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => googleDetails },
      exa: {
        configured: true,
        searchPlace: async () => ({ ...exaResponse('@cafebrasilero'), output: { ...exaResponse().output, content: { ...exaResponse('@cafebrasilero').output.content, instagram_profile_url: 'https://www.instagram.com/cafebrasilero/' } } }),
        searchText: async (query: string) => ({ query, results: [{ title: 'otracosa', url: 'https://www.instagram.com/otracosa/', highlights: [] }], requestId: 'r' }),
      },
      instagram: { configured: true, scrapeMany },
      generate: async () => extraction,
    })

    const collected = await service.collectSources('place-1', { seedCategories: ['cafe'] })

    expect(collected.instagramValidation.candidates).toEqual([
      { handle: 'cafebrasilero', decision: 'selected', reason: 'validated_exact_place_profile', rule: 'handle_exact', origins: ['exa_contact_info', 'exa_profile_field'] },
      { handle: 'otracosa', decision: 'discarded', reason: 'identity_or_location_mismatch', rule: 'no_identity_signal', origins: ['exa_instagram_search'] },
    ])
  })

  it('el perfil de instagram_profile_url de Exa entra a la primera pasada y lo valida Apify', async () => {
    const scrapeMany = vi.fn(async (urls: string[]) => urls.map((url) => ({ url, name: target.name, bio: 'Montevideo, Uruguay', links: [] })))
    const withProfile = (instagram_profile_url: string) => new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => googleDetails },
      exa: { configured: true, searchPlace: async () => ({ ...exaResponse(), output: { ...exaResponse().output, content: { ...exaResponse().output.content, instagram_profile_url } } }) },
      instagram: { configured: true, scrapeMany },
      generate: async () => extraction,
    })

    const collected = await withProfile('https://www.instagram.com/CafeBrasileroUY').collectSources('place-1', { seedCategories: ['cafe'] })

    expect(collected.instagramCandidates).toContain('https://www.instagram.com/cafebrasilerouy/')
    expect(scrapeMany).toHaveBeenCalledWith(expect.arrayContaining(['https://www.instagram.com/cafebrasilerouy/']))
    expect(exaProfileCandidate({ output: { ...exaResponse().output, content: { ...exaResponse().output.content, instagram_profile_url: '@CafeBrasileroUY' } } })).toBe('https://www.instagram.com/cafebrasilerouy/')

    for (const value of ['', 'https://www.instagram.com/p/C1abc/']) {
      const without = await withProfile(value).collectSources('place-1', { seedCategories: ['cafe'] })
      expect(without.instagramCandidates.some((url) => /cafebrasilerouy|\/p\//.test(url))).toBe(false)
    }
  })

  it('descarta fuentes de otros países por dominio o por una dirección extranjera sin mención de Uruguay', () => {
    expect(isForeignSource('https://www.brookies.com.br/p/contato', 'Brookies Cookies & Co.')).toBe(true)
    expect(isForeignSource('https://guia.example/brookies', 'Av. Independência, 1211 - Porto Alegre - RS, 90035-077')).toBe(true)
    expect(isForeignSource('https://guia.example/bar', 'Calle Buenos Aires 400, Ciudad Vieja, Montevideo')).toBe(false)
    expect(isForeignSource('https://uy.eldirectorio.co/empresas/montevideo/bar', 'Bar en Montevideo')).toBe(false)
  })

  it('devuelve el costo por proveedor con el uso real de tokens del LLM', async () => {
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => ({ ...googleDetails, websiteUri: 'https://cafe.example/' }) },
      exa: { configured: true, searchPlace: async () => exaResponse('@cafebrasilero', [{ title: target.name, url: 'https://cafe.example/menu', highlights: ['Café Brasilero'] }]) },
      instagram: { configured: true, scrapeMany: async () => [{ url: 'https://www.instagram.com/cafebrasilero/', name: target.name, bio: 'Montevideo, Uruguay', links: [] }] },
      website: { configured: true, scrape: async () => ({ url: 'https://cafe.example/', title: target.name, description: '', content: 'Café de especialidad', instagramUrls: [] }) },
      transit: { findNearbyLines: async () => ({ status: 'success', lines: [] }) },
      generate: async () => ({ data: extraction, inputTokens: 1_000_000, cachedInputTokens: 200_000, outputTokens: 100_000, gatewayCostUsd: 0.4 }),
      model: { model: 'openai/gpt-5-mini', reasoning: 'low' },
      costRates: {
        googleDetailsRequestUsd: 1,
        exaSearchRequestUsd: 2,
        exaContentPageUsd: 3,
        instagramRunUsd: 4,
        scrapingRequestUsd: 5,
        transitRequestUsd: 6,
      },
    })

    const result = await service.extract('place-1', { seedCategories: ['cafe'] })
    // 800k tokens a 0,25 + 200k cacheados a 0,025 + 100k de salida a 2 (USD por millón).
    expect(result.model).toBe('openai/gpt-5-mini')
    expect(result.performance.costUsd).toEqual({
      currency: 'USD',
      estimated: false,
      totalUsd: 21.405,
      providers: {
        google: { requests: 1, costUsd: 1 },
        exa: { requests: 1, contentPages: 1, highlightPages: 0, costUsd: 5 },
        instagram: { requests: 1, costUsd: 4 },
        scraping: { requests: 1, costUsd: 5 },
        transit: { requests: 1, costUsd: 6 },
        llm: {
          model: 'openai/gpt-5-mini', inputTokens: 1_000_000, cachedInputTokens: 200_000, cacheWriteTokens: null, outputTokens: 100_000, gatewayCostUsd: 0.4,
          inputCostUsd: 0.205, outputCostUsd: 0.2, costUsd: 0.405,
        },
      },
    })
  })

  it('consulta Google primero, luego Exa con su nombre y buses, Apify y finalmente el LLM con buses', async () => {
    const detailsRun = deferred<typeof googleDetails>()
    const exaRun = deferred<ReturnType<typeof exaResponse>>()
    const transitRun = deferred<{ status: 'success'; lines: [] }>()
    const instagramRun = deferred<{
      url: string
      name: string
      bio: string
      links: string[]
      posts: string[]
    }[]>()
    const llmRun = deferred<PlaceExtraction>()
    const events: string[] = []
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: vi.fn(() => { events.push('google'); return detailsRun.promise }) },
      exa: { configured: true, searchPlace: vi.fn(() => { events.push('exa'); return exaRun.promise }) },
      transit: { findNearbyLines: vi.fn(() => { events.push('buses'); return transitRun.promise }) },
      instagram: { configured: true, scrapeMany: vi.fn(() => { events.push('instagram'); return instagramRun.promise }) },
      generate: vi.fn(() => { events.push('llm'); return llmRun.promise }),
    })

    const resultPromise = service.extract('place-1', { seedCategories: ['cafe'] })
    expect(events).toEqual(['google'])

    detailsRun.resolve(googleDetails)
    await vi.waitFor(() => expect(events).toEqual(expect.arrayContaining(['exa', 'buses'])))
    expect(events).not.toContain('instagram')

    exaRun.resolve(exaResponse('@cafebrasilero'))
    await vi.waitFor(() => expect(events).toContain('instagram'))
    expect(events).not.toContain('llm')

    instagramRun.resolve([{
      url: 'https://www.instagram.com/cafebrasilero/',
      name: target.name,
      bio: 'Café histórico en Montevideo, Uruguay',
      links: [],
      posts: ['Café todos los días'],
    }])
    // Las fuentes incluyen los buses: el LLM arranca cuando terminan.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events).not.toContain('llm')
    transitRun.resolve({ status: 'success', lines: [] })
    await vi.waitFor(() => expect(events).toContain('llm'))
    expect(events.at(-1)).toBe('llm')

    llmRun.resolve(extraction)
    await expect(resultPromise).resolves.toMatchObject({
      status: 'ok',
      sourceAudit: { google: true, exa: true, instagram: true, instagramCandidates: ['cafebrasilero'] },
    })
  })

  it('deduplica el mismo Instagram de Google y Exa en una sola llamada de Apify', async () => {
    const scrapeMany = vi.fn().mockResolvedValue([{
      url: 'https://instagram.com/cafebrasilero/',
      name: target.name,
      bio: 'Montevideo, Uruguay',
      links: [],
    }])
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => ({ ...googleDetails, websiteUri: 'https://instagram.com/cafebrasilero/' }) },
      exa: { configured: true, searchPlace: async () => exaResponse('@CafeBrasilero') },
      instagram: { configured: true, scrapeMany },
      generate: async () => extraction,
    })

    const result = await service.extract('place-1', { seedCategories: ['cafe'] })
    expect(scrapeMany).toHaveBeenCalledOnce()
    expect(scrapeMany).toHaveBeenCalledWith(['https://www.instagram.com/cafebrasilero/'])
    expect(result.sourceAudit.instagramCandidates).toEqual(['cafebrasilero'])
    expect(result.sourceAudit.instagram).toBe(true)
  })

  it('no elige Instagram cuando dos perfiles distintos son válidos', async () => {
    let sourceKinds: string[] = []
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => googleDetails },
      exa: {
        configured: true,
        searchPlace: async () => ({
          ...exaResponse('@cafebrasilero', [{ title: 'Nota', url: 'https://guia.example/cafe', highlights: ['Café Brasilero en Montevideo'] }]),
          results: [{
            title: 'Nota',
            url: 'https://guia.example/cafe',
            highlights: ['Café Brasilero en Montevideo'],
            extras: { links: ['https://instagram.com/cafebrasilero2/'] },
          }],
        }),
      },
      instagram: {
        configured: true,
        scrapeMany: async (urls) => urls.map((url) => ({ url, name: target.name, bio: 'Montevideo, Uruguay', links: [] })),
      },
      generate: async (_place, sources) => { sourceKinds = sources.map((source) => source.kind); return extraction },
    })

    const result = await service.extract('place-1', { seedCategories: ['cafe'] })
    expect(result.sourceAudit).toMatchObject({
      exa: true,
      instagram: false,
      instagramCandidates: ['cafebrasilero', 'cafebrasilero2'],
    })
    expect(sourceKinds).toEqual(['exa', 'exa'])
  })

  it.each([
    ['perfil extranjero', async () => [{ url: 'https://instagram.com/cafebrasilero/', name: target.name, bio: 'São Paulo, Brasil', links: [] }]],
    ['handle de otro país', async () => [{ url: 'https://instagram.com/cafebrasilero.br/', name: target.name, bio: 'Café en Montevideo, Uruguay', links: [] }]],
  ])('continúa sin Instagram ante %s', async (_caseName, scrapeMany) => {
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => googleDetails },
      exa: { configured: true, searchPlace: async () => exaResponse('@cafebrasilero') },
      instagram: { configured: true, scrapeMany },
      generate: async () => extraction,
    })

    const result = await service.extract('place-1', { seedCategories: ['cafe'] })
    expect(result).toMatchObject({
      status: 'ok',
      sourceAudit: { google: true, exa: true, instagram: false, instagramCandidates: ['cafebrasilero'] },
    })
  })

  it('si Apify falla (sin reintento posible) el lugar termina con InstagramProviderFailure y no se sigue', async () => {
    const generate = vi.fn(async () => extraction)
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => googleDetails },
      exa: { configured: true, searchPlace: async () => exaResponse('@cafebrasilero') },
      instagram: { configured: true, scrapeMany: async () => { throw new PlacesProviderError('quota', 'Apify no tiene crédito disponible.') } },
      generate,
    })

    const failure = await service.extract('place-1', { seedCategories: ['cafe'] }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(InstagramProviderFailure)
    expect((failure as Error).message).toBe('Error de Apify: no se pudo consultar Instagram. Apify no tiene crédito disponible.')
    expect(generate).not.toHaveBeenCalled()
  })

  it('reintenta Apify ante timeout y sigue si se recupera; agotados los reintentos, falla', async () => {
    const profile = { url: 'https://instagram.com/cafebrasilero/', name: target.name, bio: 'Montevideo, Uruguay', links: [] }
    const scrapeMany = vi.fn()
      .mockRejectedValueOnce(new TransientProviderError('timeout', 'Instagram demoró demasiado en responder.'))
      .mockResolvedValueOnce([profile])
    const build = (scrape: typeof scrapeMany) => new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => googleDetails },
      exa: { configured: true, searchPlace: async () => exaResponse('@cafebrasilero') },
      instagram: { configured: true, scrapeMany: scrape },
      generate: async () => extraction,
      rateLimitRetry: { sleep: async () => {}, random: () => 0, transientDelaysMs: [5, 15] },
    })

    const recovered = await build(scrapeMany).extract('place-1', { seedCategories: ['cafe'] })
    if (recovered.status !== 'ok') throw new Error('se esperaba ok')
    expect(recovered.sourceAudit.instagram).toBe(true)
    expect(recovered.review.rateLimits).toEqual([{ service: 'apify', retries: 0, transientRetries: 1, waitedMs: 5, recovered: true }])

    const alwaysTimeout = vi.fn(async () => { throw new TransientProviderError('timeout', 'Instagram demoró demasiado en responder.') })
    await expect(build(alwaysTimeout).extract('place-2', { seedCategories: ['cafe'] })).rejects.toBeInstanceOf(InstagramProviderFailure)
    expect(alwaysTimeout).toHaveBeenCalledTimes(3)
  })

  it('si Exa falla (la búsqueda estructurada o la dirigida a Instagram) el lugar termina con ExaProviderFailure y no se sigue', async () => {
    const generate = vi.fn(async () => extraction)
    const scrapeMany = vi.fn(async () => [{ url: 'https://instagram.com/cafebrasilero/', name: target.name, bio: 'Montevideo, Uruguay', links: [] }])
    const build = (exa: ConstructorParameters<typeof PlaceExtractionService>[0]['exa']) => new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => ({ ...googleDetails, websiteUri: 'https://instagram.com/cafebrasilero/' }) },
      exa,
      instagram: { configured: true, scrapeMany },
      generate,
    })

    const structured = await build({ configured: true, searchPlace: async () => { throw new PlacesProviderError('upstream', 'Exa no pudo completar la consulta.') } })
      .extract('place-1', { seedCategories: ['cafe'] }).catch((error: unknown) => error)
    expect(structured).toBeInstanceOf(ExaProviderFailure)
    expect((structured as Error).message).toBe('Error de Exa: no se pudo consultar Exa. Exa no pudo completar la consulta.')

    const directed = await build({
      configured: true,
      searchPlace: async () => exaResponse('@cafebrasilero'),
      searchText: async () => { throw new PlacesProviderError('upstream', 'Exa no pudo completar la consulta.') },
    }).collectSources('place-1', { seedCategories: ['cafe'] }).catch((error: unknown) => error)
    expect(directed).toBeInstanceOf(ExaProviderFailure)

    expect(generate).not.toHaveBeenCalled()
    expect(scrapeMany).not.toHaveBeenCalled()
  })

  it('limita Exa, el LLM y Apify entre extracciones concurrentes', async () => {
    const tracker = () => {
      const state = { active: 0, max: 0 }
      const run = async <T>(value: T) => {
        state.active += 1
        state.max = Math.max(state.max, state.active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        state.active -= 1
        return value
      }
      return { state, run }
    }
    const exa = tracker()
    const llm = tracker()
    const apify = tracker()
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => googleDetails },
      exa: { configured: true, searchPlace: () => exa.run(exaResponse('@cafebrasilero')) },
      instagram: { configured: true, scrapeMany: () => apify.run([]) },
      generate: () => llm.run(extraction),
      // Los 8 comparten el candidato: sin registro, para que todos lleguen a Apify.
      candidateRegistry: { claim: () => new Map() },
    })

    await Promise.all(Array.from({ length: 8 }, (_, index) => service.extract(`place-${index}`, { seedCategories: ['cafe'] })))

    expect(exa.state.max).toBe(3)
    expect(llm.state.max).toBe(3)
    expect(apify.state.max).toBe(2)
  })

  it('busca en Exa con el nombre que devuelve Google', async () => {
    const searchPlace = vi.fn(async () => exaResponse())
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => googleDetails },
      exa: { configured: true, searchPlace },
      generate: async () => extraction,
    })

    await service.extract('place-1', { seedCategories: ['cafe'] })
    // Café Brasilero es rubro + tag: marca genérica, va con el barrio de las coordenadas.
    expect(searchPlace).toHaveBeenCalledWith(`${googleDetails.anchor.name} Ciudad Vieja`)
  })

  it('usa el neighborhoodId recibido y, si no llega, lo calcula con las coordenadas', async () => {
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => googleDetails },
      exa: { configured: true, searchPlace: async () => exaResponse() },
      generate: async () => extraction,
    })

    const given = await service.extract('place-1', { seedCategories: ['cafe'], neighborhoodId: 'POCITOS' })
    const computed = await service.extract('place-1', { seedCategories: ['cafe'] })
    expect(given).toMatchObject({ status: 'ok', place: { neighborhoodId: 'POCITOS' } })
    expect(computed).toMatchObject({
      status: 'ok',
      place: { neighborhoodId: getNeighborhood(googleDetails.anchor.latitude, googleDetails.anchor.longitude).neighborhoodId },
    })
  })

  it('clasifica fuentes propias, directorios, reservas y bloqueados', () => {
    const context = { name: 'Café Brasilero', websiteUrl: 'https://cafebrasilero.uy/', instagramUrls: ['https://www.instagram.com/cafebrasilero/'] }
    expect(classifySource('https://cafebrasilero.uy/menu', context)).toBe('web')
    expect(classifySource('https://www.instagram.com/cafebrasilero/', context)).toBe('instagram')
    expect(classifySource('https://www.instagram.com/cafebrasilero.br/', context)).toBe('blocked')
    expect(classifySource('https://meitre.com/cafe-brasilero', context)).toBe('reservations')
    expect(classifySource('https://opina.com.uy/cafe-brasilero', context)).toBe('directory')
    for (const url of ['https://maps.google.com/', 'https://maps.app.goo.gl/x', 'https://exa.ai/library/x', 'https://tripadvisor.com/Restaurant', 'https://www.facebook.com/cafe', 'https://foursquare.com/v/cafe']) {
      expect(classifySource(url, context)).toBe('blocked')
    }
  })

  it('usa el resumen y resultados individuales de Exa, y registra bloqueos', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    let generatedSources: Source[] = []
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => ({ source: 'google', exactMatch: true, anchor: { name: 'Café Brasilero', address: target.address, latitude: target.coordinates.lat, longitude: target.coordinates.lng }, websiteUri: null, data: {}, attribution: 'Google Maps' }) },
      exa: { configured: true, searchPlace: async () => ({ source: 'exa', query: 'Café Brasilero, Montevideo, Uruguay', output: { content: { description: 'SUMMARY_MUST_NOT_BE_A_SOURCE', address: '', contact_info: '', open_hours_raw: '', open_hours: [], knows_before_you_go: 'KNOWS_MUST_BE_PRESERVED', menu: [] }, grounding: { url: 'https://exa.ai/library/ignored' } }, results: [
        { title: 'Café Brasilero', url: 'https://cafebrasilero.uy/', highlights: ['Café histórico de Montevideo'] },
        { title: 'Bloqueado', url: 'https://exa.ai/library/no', highlights: ['No usar'] },
      ], requestId: 'exa-1', attribution: 'Exa' }) },
      generate: async (_target, sources) => {
        generatedSources = sources
        return emptyExtraction
      },
    })
    await service.extract('place-1', { seedCategories: ['cafe'] })
    expect(generatedSources).toEqual([
      expect.objectContaining({ id: 'S1', kind: 'exa', trust: 'third_party', url: 'https://exa.ai/' }),
      expect.objectContaining({ id: 'S2', kind: 'exa', trust: 'third_party', url: 'https://cafebrasilero.uy/', text: 'Café histórico de Montevideo' }),
    ])
    expect(generatedSources[0].text).toContain('SUMMARY_MUST_NOT_BE_A_SOURCE')
    expect(generatedSources[0].text).toContain('KNOWS_MUST_BE_PRESERVED')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"blockedDomains":["exa.ai"]'))
    log.mockRestore()
  })

  it('prioriza precios determinísticos por persona y respeta sus límites', () => {
    const priceFrom = (sources: { id: string; kind: 'web'; trust: 'official' | 'third_party'; url: string; text: string }[]) => postProcess(target, {
      ...extraction,
      price: 'very_high',
      support: [],
    }, { sources })

    expect(priceFrom([{
      id: 'S1', kind: 'web', trust: 'official', url: 'https://local.example/',
      text: 'El gasto es de $700 a $1.100 por persona.',
    }]).price).toBe('moderate')
    expect(priceFrom([{
      id: 'S1', kind: 'web', trust: 'official', url: 'https://local.example/',
      text: 'Precio promedio $ 599 por persona.',
    }]).price).toBe('low')
    expect(priceFrom([{
      id: 'S1', kind: 'web', trust: 'official', url: 'https://local.example/',
      text: 'Precio promedio $1.200 por persona.',
    }]).price).toBe('high')
    expect(priceFrom([{
      id: 'S1', kind: 'web', trust: 'official', url: 'https://local.example/',
      text: 'Precio promedio $2.500 por persona.',
    }]).price).toBe('high')
    expect(priceFrom([{
      id: 'S1', kind: 'web', trust: 'official', url: 'https://local.example/',
      text: 'Precio promedio $2.501 por persona.',
    }]).price).toBe('very_high')
  })

  it('usa la mediana de precios oficiales e ignora importes ajenos o en otra moneda', () => {
    const place = postProcess(target, {
      ...extraction,
      price: 'very_high',
      support: [],
    }, { sources: [
      {
        id: 'S1', kind: 'web', trust: 'official', url: 'https://local.example/',
        text: 'Precio promedio $700 por persona. Precio promedio $1.300 por persona.',
      },
      {
        id: 'S2', kind: 'directory', trust: 'third_party', url: 'https://directorio.example/',
        text: 'Precio promedio $5.000 por persona.',
      },
    ] })
    expect(place.price).toBe('moderate')

    const noPrice = postProcess(target, { ...extraction, price: 'high', support: [] }, { sources: [{
      id: 'S1', kind: 'web', trust: 'official', url: 'https://local.example/',
      text: 'Precio promedio US$ 25 por persona. Copa $500.',
    }] })
    expect(noPrice.price).toBe('unknown')
  })

  it('deduplica líneas repetidas y reporta el ahorro estimado de entrada', () => {
    const result = deduplicateSourceText([
      { id: 'S1', kind: 'exa', trust: 'third_party', url: 'https://exa.ai/', text: 'Tarta de estación\nSpritz cítrico\nPatio' },
      { id: 'S2', kind: 'exa', trust: 'third_party', url: 'https://example.com/', text: 'Spritz cítrico\nPatio\nTerraza' },
    ])
    expect(result.sources).toEqual([
      expect.objectContaining({ id: 'S1', text: 'Tarta de estación\nSpritz cítrico\nPatio' }),
      expect.objectContaining({ id: 'S2', text: 'Terraza' }),
    ])
    expect(result.stats.afterChars).toBeLessThan(result.stats.beforeChars)
    expect(result.stats.estimatedInputTokensSaved).toBeGreaterThan(0)
  })

  it('audita un handle de Exa aunque el candidato de Instagram quede descartado', async () => {
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => googleDetails },
      exa: {
        configured: true,
        searchPlace: async () => {
          const response = exaResponse()
          return {
            ...response,
            results: [{ title: 'Instagram', url: 'https://example.com/', highlights: [], extras: { links: ['https://instagram.com/magnolio.uy/'] } }],
            output: { content: { ...response.output.content, contact_info: 'Instagram: @oriundo.uy' }, grounding: {} },
          }
        },
      },
      generate: async () => ({
        ...emptyExtraction,
        facts: [{ id: 'F1', text: 'su Instagram es @oriundo.uy', sourceId: 'S1', kind: 'contact', proposedTag: null }],
        contact: { ...extraction.contact, instagram: 'oriundo.uy' },
        support: [{ field: 'contact.instagram', facts: ['F1'] }],
      }),
    })

    const result = await service.extract('place-1', { seedCategories: ['cafe'] })
    expect(result).toMatchObject({
      status: 'ok',
      sourceAudit: {
        instagram: false,
        instagramCandidates: ['oriundo.uy', 'magnolio.uy'],
        instagramSelection: {
          handle: 'oriundo.uy', origin: 'exa_summary',
          candidates: [
            { handle: 'oriundo.uy', decision: 'unavailable', reason: 'instagram_provider_not_configured' },
            { handle: 'magnolio.uy', decision: 'unavailable', reason: 'instagram_provider_not_configured' },
          ],
        },
      },
    })
  })

  it('resuelve contactos determinísticos sólo desde el texto y los links de las fuentes, nunca de Google', () => {
    const sources = [{
      id: 'S1', kind: 'exa' as const, trust: 'third_party' as const, url: 'https://example.com/',
      text: 'Reservas https://oriundo.meitre.com/ · Instagram: @magnolio.uy · Correo: @oriundo.uy · Tel: 099 111 222',
      links: ['https://instagram.com/magnolio.uy/', 'https://instagram.com/oriundo.uy/'],
    }]
    const contact = resolveDeterministicContact({
      ...googleDetails,
      anchor: { ...googleDetails.anchor, name: 'Oriundo' },
      websiteUri: 'https://oriundo.uy/',
      phoneNumber: '+598 2418 5404',
    }, sources)

    // El teléfono de las fuentes ya no se carga.
    expect(contact).toEqual({
      reservationUrl: 'https://oriundo.meitre.com/',
      instagram: 'oriundo.uy',
    })
    // La web y el teléfono de Google no se usan, tampoco una web de Google que sea de reservas.
    expect(resolveDeterministicContact({
      ...googleDetails,
      websiteUri: 'https://oriundo.meitre.com/',
      phoneNumber: '+598 2418 5404',
    }, [])).toEqual({})
    expect(resolveDeterministicContact({ ...googleDetails, websiteUri: 'https://instagram.com/oriundo.uy/' }, [])).toEqual({})
    expect(resolveDeterministicContact({ ...googleDetails, websiteUri: null }, [{
      ...sources[0], links: ['https://book.example/reserva'], text: 'Reservas https://book.example/reserva',
    }], ['book.example'])).toMatchObject({ reservationUrl: 'https://book.example/reserva' })
  })

  it('extrae handles aislados de todas las fuentes y descarta emails', () => {
    const contact = resolveDeterministicContact({
      ...googleDetails,
      anchor: { ...googleDetails.anchor, name: 'Oriundo' },
      websiteUri: null,
    }, [{
      id: 'S1', kind: 'directory', trust: 'third_party', url: 'https://alacarta.com.uy/oriundo/',
      text: 'Correo: @oriundo.uy',
    }])
    expect(contact.instagram).toBe('oriundo.uy')

    const emailOnly = resolveDeterministicContact({
      ...googleDetails,
      anchor: { ...googleDetails.anchor, name: 'Culto Café' },
      websiteUri: null,
    }, [{
      id: 'S1', kind: 'directory', trust: 'third_party', url: 'https://alacarta.com.uy/culto-cafe/',
      text: 'Correo: hola@cultocafe.uy',
    }])
    expect(emailOnly).not.toHaveProperty('instagram')
  })

  it('respalda un plato si sus palabras significativas están en un mismo fact', () => {
    expect(dishSupportedBy('milanesa napolitana', 'Sirven milanesas a la napolitana con fritas')).toBe(true)
    expect(dishSupportedBy('chivito canadiense', 'El clásico es el chivito al pan canadiense')).toBe(true)
    expect(dishSupportedBy('Pulpo a la gallega', 'pulpo gallego')).toBe(false)
    expect(dishSupportedBy('flan con dulce de leche', 'Flanes caseros con dulce de leche')).toBe(true)
    expect(dishSupportedBy('milanesa napolitana', 'Hay milanesas')).toBe(false)
    expect(dishSupportedBy('de la', 'de la casa')).toBe(false)
  })

  it('guarda sólo platos respaldados por un fact, normalizados, sin repetir y hasta 15', () => {
    const source: Source = { id: 'S1', kind: 'exa', trust: 'third_party', url: 'https://guia.example/', text: 'bodegón' }
    const many = Array.from({ length: 20 }, (_, index) => `plato${index}`)
    const place = postProcess(target, {
      ...emptyExtraction,
      facts: [
        { id: 'F1', text: 'Sirven milanesas a la napolitana', sourceId: 'S1', kind: 'food', proposedTag: null },
        { id: 'F2', text: 'El clásico es el chivito al pan canadiense', sourceId: 'S1', kind: 'food', proposedTag: null },
        { id: 'F3', text: 'Tienen ravioles', sourceId: 'S1', kind: 'food', proposedTag: null },
        { id: 'F4', text: 'y también salsa bolognesa', sourceId: 'S1', kind: 'food', proposedTag: null },
        { id: 'F5', text: `Carta: ${many.join(', ')}`, sourceId: 'S1', kind: 'food', proposedTag: null },
      ],
      dishes: ['Milanesa Napolitana', 'chivito canadiense', 'milanesas napolitanas', 'ravioles bolognesa', 'lasaña', ...many],
    }, { sources: [source] })
    expect(place.dishes.slice(0, 2)).toEqual(['milanesa napolitana', 'chivito canadiense'])
    expect(place.dishes).not.toContain('ravioles bolognesa')
    expect(place.dishes).not.toContain('lasaña')
    expect(place.dishes).toHaveLength(15)
    expect(place.keywordText).toContain('milanesa napolitana')
    expect(place.embeddingText).not.toContain('milanesa napolitana')
  })

  it('convierte el contacto vacío del modelo en null', () => {
    const place = postProcess(target, {
      ...emptyExtraction,
      contact: { instagram: '  ', website: '' },
    }, { sources: [{ id: 'S1', kind: 'exa', trust: 'third_party', url: 'https://guia.example/', text: 'café' }] })
    expect(place.contact).toEqual({ instagram: null, website: null })
  })

  it('acepta una cocina sólo si un texto nombra su label o un sinónimo', () => {
    expect(cuisineMentioned('mexican', ['Carta con tacos veganos'])).toBe(false)
    expect(cuisineMentioned('italian', ['Cocina italiana casera'])).toBe(true)
    expect(cuisineMentioned('middle_eastern', ['Comida arabe para compartir'])).toBe(true)
    expect(cuisineMentioned('middle_eastern', ['Comida árabe para compartir'])).toBe(true)
    expect(cuisineMentioned('japanese', ['Sirven sushi'])).toBe(false)
    expect(cuisineMentioned('inventada', ['cocina inventada'])).toBe(false)
  })

  it('acepta una cocina por dos platos típicos distintos, nunca por uno suelto', () => {
    const facts = (...texts: string[]) => texts.map((text, index) => ({ id: `F${index + 1}`, text }))
    expect(cuisineSupport('mexican', facts('Carta con tacos veganos'))).toBeNull()
    expect(cuisineSupport('mexican', facts('Tacos al pastor', 'Burritos de carne'))).toEqual({
      tag: 'mexican', mode: 'inferred', signals: ['taco', 'burrito'], factIds: ['F1', 'F2'],
    })
    expect(cuisineSupport('middle_eastern', facts('Shawarma de pollo y falafel'))?.signals).toEqual(['shawarma', 'falafel'])
    expect(cuisineSupport('venezuelan', facts('Arepas rellenas', 'Tequeños con salsa'))?.mode).toBe('inferred')
    expect(cuisineSupport('peruvian', facts('Ceviche clásico'))).toBeNull()
    // Nombrarla sigue alcanzando, con evidencia explícita.
    expect(cuisineSupport('mexican', facts('Taquería de barrio'))).toEqual({ tag: 'mexican', mode: 'explicit', signals: ['taquería'], factIds: ['F1'] })
    // curry ya no es sinónimo de india: un curry suelto (por ejemplo tailandés) no la identifica.
    expect(cuisineSupport('indian', facts('Curry tailandés de pollo'))).toBeNull()
    expect(cuisineSupport('indian', facts('Curry de garbanzos con naan'))?.signals).toEqual(['curry', 'naan'])
    // "a causa de" no es el plato causa limeña.
    expect(cuisineSupport('peruvian', facts('Cerrado a causa de obras', 'Ceviche del día'))).toBeNull()
  })

  it('en un lugar nikkei, a japonesa y peruana les alcanza un plato típico', () => {
    const facts = [
      { id: 'F1', text: 'Cocina nikkei en Pocitos' },
      { id: 'F2', text: 'Rolls de sushi acevichados' },
      { id: 'F3', text: 'Ceviche clásico' },
    ]
    expect([...supportedCuisines(['nikkei', 'japanese', 'peruvian'], facts).keys()]).toEqual(['nikkei', 'japanese', 'peruvian'])
    expect([...supportedCuisines(['japanese', 'peruvian'], facts.slice(1)).keys()]).toEqual([])
  })

  it('una cocina que entra por platos queda en tagEvidence con los platos', () => {
    const sources: Source[] = [{ id: 'S1', kind: 'exa', trust: 'third_party', url: 'https://guia.example/', text: 'tacos y burritos' }]
    const data: PlaceExtraction = {
      ...emptyExtraction,
      facts: [
        { id: 'F1', text: 'Tacos al pastor', sourceId: 'S1', kind: 'food', proposedTag: null },
        { id: 'F2', text: 'Burritos de carne', sourceId: 'S1', kind: 'food', proposedTag: null },
      ],
      tags: [
        { group: 'categories', id: 'restaurant', facts: ['F1'] },
        { group: 'cuisines', id: 'mexican', facts: ['F1', 'F2'] },
      ],
    }
    const place = postProcess(target, data, { sources })
    expect(place.tags).toContain('mexican')
    expect(place.tagEvidence).toContainEqual({ tag: 'mexican', mode: 'inferred', signals: ['taco', 'burrito'], factIds: ['F1', 'F2'] })
    expect(reviewExtraction(place, data).anomalies.map((anomaly) => anomaly.type)).not.toContain('cuisine_unmentioned')
  })

  it('deduce una cocina que el modelo no propuso con dos platos típicos de fuentes reales', () => {
    const web = { id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://rincon.example/', text: 'Pelmeni y vareniki caseros' }
    const exa = { id: 'S2', kind: 'exa' as const, trust: 'third_party' as const, url: EXA_SUMMARY_URL, text: 'Pelmeni y vareniki' }
    const cuisinesOf = (...facts: [string, string][]) => {
      const data: PlaceExtraction = {
        ...emptyExtraction,
        facts: facts.map(([text, sourceId], index) => ({ id: `F${index + 1}`, text, sourceId, kind: 'food' as const, proposedTag: null })),
        tags: [{ group: 'categories', id: 'restaurant', facts: ['F1'] }],
      }
      const place = postProcess(target, data, { sources: [web, exa] })
      return { cuisines: place.tags.filter((tag) => groupOf(tag) === 'cuisines'), evidence: place.tagEvidence?.find((item) => item.tag === 'russian') }
    }

    expect(cuisinesOf(['Pelmeni de carne', 'S1'], ['Vareniki de papa y cebolla', 'S1'])).toEqual({
      cuisines: ['russian'],
      evidence: { tag: 'russian', mode: 'inferred', signals: ['pelmeni', 'vareniki'], factIds: ['F1', 'F2'] },
    })
    // Un plato solo, o los platos sólo en el resumen de Exa, no alcanzan.
    expect(cuisinesOf(['Pelmeni de carne', 'S1']).cuisines).toEqual([])
    expect(cuisinesOf(['Pelmeni de carne', 'S2'], ['Vareniki de papa', 'S2']).cuisines).toEqual([])
    // "Rusa" suelta no es la cocina: ni la ensalada rusa ni una pareja rusa; tampoco "comida rusa" sin platos.
    expect(cuisinesOf(['Ensalada rusa casera', 'S1'], ['Restaurante de una pareja rusa', 'S1'], ['Comida rusa', 'S1']).cuisines).toEqual([])
    expect(cuisineSupport('russian', [{ id: 'F1', text: 'Comida rusa y ensalada rusa' }])).toBeNull()
  })

  it('descarta las cocinas que ningún fact nombra y las anota en review', () => {
    const sources: Source[] = [{ id: 'S1', kind: 'exa', trust: 'third_party', url: 'https://guia.example/', text: 'bar' }]
    const data: PlaceExtraction = {
      ...emptyExtraction,
      facts: [
        { id: 'F1', text: 'Carta con tacos veganos y falafel', sourceId: 'S1', kind: 'food', proposedTag: 'middle_eastern' },
        { id: 'F2', text: 'Cocina italiana casera', sourceId: 'S1', kind: 'food', proposedTag: null },
      ],
      tags: [
        { group: 'categories', id: 'bar', facts: ['F1'] },
        { group: 'cuisines', id: 'mexican', facts: ['F1'] },
        { group: 'cuisines', id: 'italian', facts: ['F2'] },
      ],
    }
    const place = postProcess(target, data, { sources })
    expect(place.tags).toContain('italian')
    expect(place.tags).not.toContain('mexican')
    expect(place.tags).not.toContain('middle_eastern')
    expect(reviewExtraction(place, data).anomalies).toContainEqual({ type: 'cuisine_unmentioned', detail: 'mexican, middle_eastern' })
  })

  it('mantiene la cocina que agrega el código para una parrilla aunque ningún fact la nombre', () => {
    const place = postProcess(target, {
      ...emptyExtraction,
      facts: [{ id: 'F1', text: 'Parrilla a leña con achuras', sourceId: 'S1', kind: 'food', proposedTag: null }],
      tags: [{ group: 'categories', id: 'grill', facts: ['F1'] }],
    }, { sources: [{ id: 'S1', kind: 'exa', trust: 'third_party', url: 'https://guia.example/', text: 'parrilla' }] })
    expect(place.tags).toContain('uruguayan')
  })

  it('acepta signature sólo con ids que quedaron en tags, sin repetir y hasta 3', () => {
    const facts = [{ id: 'F1', text: 'bar acogedor con cerveza artesanal y DJ', sourceId: 'S1', kind: 'drink' as const, proposedTag: null }]
    const place = postProcess(target, {
      ...emptyExtraction,
      facts,
      tags: [
        { group: 'categories', id: 'bar', facts: ['F1'] }, { group: 'drinks', id: 'craft_beer', facts: ['F1'] },
        { group: 'atmosphere', id: 'cozy', facts: ['F1'] }, { group: 'features', id: 'dj', facts: ['F1'] },
        { group: 'atmosphere', id: 'elegant', facts: [] },
      ],
      signature: ['craft_beer', 'craft_beer', 'inventado', 'elegant', 'cozy', 'bar', 'dj'],
    }, { sources: [{ id: 'S1', kind: 'exa', trust: 'third_party', url: 'https://guia.example/', text: 'Un bar acogedor con cerveza artesanal y DJ' }] })
    expect(place.tags).toEqual(expect.arrayContaining(['craft_beer', 'cozy', 'dj']))
    expect(place.tags).not.toContain('elegant')
    expect(place.signature).toEqual(['craft_beer', 'cozy', 'dj'])
    expect(place.embeddingText).toContain('Cerveza artesanal')
    expect(place.embeddingText).toContain('Acogedor')
    expect(place.embeddingText).toContain('DJ')
  })

  it('features, goodFor, offers y atmosphere no salen sólo del resumen de Exa; features, goodFor y atmosphere necesitan nombrarse', () => {
    const summary: Source = { id: 'S1', kind: 'exa', trust: 'third_party', url: 'https://exa.ai/', text: 'RESUMEN ESTRUCTURADO DE EXA' }
    const page: Source = { id: 'S2', kind: 'exa', trust: 'third_party', url: 'https://guia.example/bar', text: 'Bar' }
    const place = postProcess(target, {
      ...emptyExtraction,
      facts: [
        { id: 'F1', text: 'Tiene pizzas y es accesible, con plato del día', sourceId: 'S1', kind: 'food', proposedTag: null },
        { id: 'F2', text: 'Reciben pedidos por PedidosYa', sourceId: 'S2', kind: 'other', proposedTag: null },
        { id: 'F3', text: 'Se mira fútbol en pantalla grande', sourceId: 'S2', kind: 'other', proposedTag: null },
        { id: 'F4', text: 'Tiene carta de cócteles, vinos y cervezas', sourceId: 'S2', kind: 'drink', proposedTag: null },
        { id: 'F5', text: 'Hay plato del día al mediodía', sourceId: 'S2', kind: 'food', proposedTag: null },
      ],
      tags: [
        // Comidas pueden salir sólo del resumen; accessible y menu_of_the_day no.
        { group: 'foods', id: 'pizza', facts: ['F1'] },
        { group: 'features', id: 'accessible', facts: ['F1'] },
        { group: 'offers', id: 'menu_of_the_day', facts: ['F1'] },
        // De una página: delivery y watch_football se nombran con sus sinónimos; groups no se nombra.
        { group: 'features', id: 'delivery', facts: ['F2'] },
        { group: 'features', id: 'watch_football', facts: ['F3'] },
        { group: 'goodFor', id: 'groups', facts: ['F4'] },
      ],
    }, { sources: [summary, page] })
    expect(place.tags).toEqual(expect.arrayContaining(['pizza', 'delivery', 'watch_football']))
    expect(place.tags).not.toContain('accessible')
    expect(place.tags).not.toContain('menu_of_the_day')
    expect(place.tags).not.toContain('groups')

    // offers no necesita nombrarse, pero sí un fact fuera del resumen.
    const withPage = postProcess(target, {
      ...emptyExtraction,
      facts: [{ id: 'F5', text: 'Hay almuerzo ejecutivo', sourceId: 'S2', kind: 'food', proposedTag: null }],
      tags: [{ group: 'offers', id: 'menu_of_the_day', facts: ['F5'] }],
    }, { sources: [summary, page] })
    expect(withPage.tags).toContain('menu_of_the_day')
  })

  it('una picada hace al lugar para grupos aunque la fuente no diga "para compartir", incluso si el modelo propuso groups y se descartó', () => {
    const page: Source = { id: 'S1', kind: 'web', trust: 'official', url: 'https://matute.example/', text: 'Cervecería. Picadas, pizzas y cerveza tirada.' }
    const place = postProcess(target, {
      ...emptyExtraction,
      facts: [
        { id: 'F1', text: 'Tiene picadas', sourceId: 'S1', kind: 'food', proposedTag: null },
        { id: 'F2', text: 'Sirve pizzas', sourceId: 'S1', kind: 'food', proposedTag: null },
      ],
      tags: [
        { group: 'foods', id: 'picada', facts: ['F1'] },
        { group: 'foods', id: 'pizza', facts: ['F2'] },
        { group: 'goodFor', id: 'groups', facts: ['F2'] },
      ],
    }, { sources: [page] })
    expect(place.tags).toEqual(expect.arrayContaining(['picada', 'groups']))
    expect(place.tagEvidence).toContainEqual({ tag: 'groups', mode: 'inferred', signals: ['picada (tag)'], factIds: ['F1'] })

    const withoutPicada = postProcess(target, {
      ...emptyExtraction,
      facts: [{ id: 'F2', text: 'Sirve pizzas', sourceId: 'S1', kind: 'food', proposedTag: null }],
      tags: [{ group: 'foods', id: 'pizza', facts: ['F2'] }],
    }, { sources: [page] })
    expect(withoutPicada.tags).not.toContain('groups')
  })

  it('un tag respaldado sólo por el resumen de Exa se queda si una fuente real lo nombra', () => {
    const summary: Source = { id: 'S1', kind: 'exa', trust: 'third_party', url: 'https://exa.ai/', text: 'RESUMEN ESTRUCTURADO DE EXA\nTiene delivery a través de Rappi. Tiene wifi.' }
    const rappi: Source = { id: 'S2', kind: 'exa', trust: 'third_party', url: 'https://www.rappi.com.uy/restaurantes/113414-pancho-va', text: 'Pancho Va! Precios y Menú para Delivery - Rappi\nPancho de soja $250' }
    const pancho = { ...target, name: 'Pancho Va!' }
    const place = postProcess(pancho, {
      ...emptyExtraction,
      facts: [
        { id: 'F1', text: 'Tiene delivery a través de Rappi', sourceId: 'S1', kind: 'other', proposedTag: null },
        { id: 'F2', text: 'Tiene wifi', sourceId: 'S1', kind: 'other', proposedTag: null },
      ],
      tags: [{ group: 'features', id: 'delivery', facts: ['F1'] }, { group: 'features', id: 'wifi', facts: ['F2'] }],
    }, { sources: [summary, rappi] })
    // delivery queda por la página de Rappi, que lo nombra; wifi sólo lo dice el resumen y se va.
    expect(place.tags).toContain('delivery')
    expect(place.tags).not.toContain('wifi')
    expect(place.placeFacts.find((fact) => fact.supports.includes('features.delivery') && fact.sourceUrl === rappi.url)?.text)
      .toBe('Pancho Va! Precios y Menú para Delivery - Rappi')
  })

  it('agrega delivery si hay una página del local en Rappi o PedidosYa, aunque nadie lo proponga', () => {
    const page = (url: string, text: string): Source => ({ id: 'S1', kind: 'exa', trust: 'third_party', url, text })
    const run = (source: Source) => postProcess({ ...target, name: 'Heladería Marca' }, emptyExtraction, { sources: [source] })

    const withPage = run(page('https://www.pedidosya.com.uy/restaurantes/montevideo/heladeria-marca', 'Heladería Marca - Helados'))
    expect(withPage.tags).toContain('delivery')
    expect(withPage.tags).not.toContain('takeaway')
    expect(withPage.placeFacts.find((fact) => fact.supports.includes('features.delivery'))?.text).toBe('Tiene página de pedidos en pedidosya.com.uy')
    // Una página de Rappi de otro local no cuenta.
    expect(run(page('https://www.rappi.com.uy/restaurantes/125589-bliss-cookies', 'Bliss Cookies')).tags).not.toContain('delivery')
  })

  it('saca de signature servicios y logística, y momentos que no definen al lugar', () => {
    expect(signatureAllowed('delivery', 'Bar Uno', 'Un bar de barrio.')).toBe(false)
    expect(signatureAllowed('wifi', 'Bar Uno', 'Un bar de barrio.')).toBe(false)
    expect(signatureAllowed('menu_of_the_day', 'Bar Uno', 'Un bar de barrio.')).toBe(false)
    expect(signatureAllowed('live_music', 'Bar Uno', 'Un bar de barrio.')).toBe(true)
    // Un momento sólo si el nombre o la primera oración de la descripción lo nombran.
    expect(signatureAllowed('brunch', 'Café Uno', 'Un café de brunch con mesas al sol. Abre de mañana.')).toBe(true)
    expect(signatureAllowed('brunch', 'Brunch Club', 'Un café con mesas al sol.')).toBe(true)
    expect(signatureAllowed('lunch', 'Resto Uno', 'Un restaurante de pastas. Abre al mediodía.')).toBe(false)
    expect(signatureAllowed('afternoon_snack', 'Café Uno', 'Un café de especialidad.')).toBe(false)

    const facts = [{ id: 'F1', text: 'pizzas con delivery, para cenar y con música en vivo', sourceId: 'S1', kind: 'food' as const, proposedTag: null }]
    const place = postProcess(target, {
      ...emptyExtraction,
      facts,
      description: { es: 'Una pizzería de barrio con música en vivo.', en: 'A neighborhood pizzeria with live music.' },
      tags: [
        { group: 'foods', id: 'pizza', facts: ['F1'] }, { group: 'features', id: 'delivery', facts: ['F1'] },
        { group: 'moments', id: 'dinner', facts: ['F1'] }, { group: 'features', id: 'live_music', facts: ['F1'] },
      ],
      signature: ['delivery', 'dinner', 'pizza', 'live_music'],
    }, { sources: [{ id: 'S1', kind: 'exa', trust: 'third_party', url: 'https://guia.example/', text: 'pizzas' }] })
    expect(place.tags).toEqual(expect.arrayContaining(['delivery', 'dinner']))
    expect(place.signature).toEqual(['pizza', 'live_music'])
    expect(SYSTEM_PROMPT).toContain('Nunca servicios o logística (delivery, takeaway, wifi, outlets, accessible, pet_friendly, menu_of_the_day)')
  })

  it('lista atmosphere y bodegon entre los ids permitidos y pide cocinas sólo por el estilo principal', () => {
    expect(SYSTEM_PROMPT).toContain('- atmosphere: quiet, lively, cozy, elegant, neighborhood_spot')
    expect(SYSTEM_PROMPT).toMatch(/- categories: .*bodegon/)
    expect(SYSTEM_PROMPT).toContain('nunca por un plato suelto')
  })

  it('preserva la semilla y aplica el contacto determinístico sobre el LLM', () => {
    const place = postProcess(target, {
      ...extraction,
      tags: [{ group: 'categories', id: 'wine_bar', facts: ['F1'] }],
      reservations: 'no_reservations',
      contact: { ...extraction.contact, instagram: 'marca-ajena', website: 'https://incorrecta.example/' },
      facts: [{ id: 'F1', text: 'es un wine bar', sourceId: 'S1', kind: 'other', proposedTag: null }],
      support: [],
    }, {
      seedCategories: ['bar'],
      sources: [{ id: 'S1', kind: 'exa', trust: 'third_party', url: 'https://example.com/', text: 'wine bar' }],
      deterministicContact: { instagram: 'oriundo.uy', reservationUrl: 'https://oriundo.meitre.com/' },
    })
    expect(place.categories).toEqual(['wine_bar', 'bar'])
    // El link de reservas no se guarda: sólo dice que toma reservas.
    expect(place.contact).toEqual({ instagram: 'oriundo.uy', website: null })
    expect(place.reservations).toBe('accepts')
  })

  it('si el modelo rechaza el Instagram validado, no queda como contacto ni sus seguidores', () => {
    const context = {
      sources: [{ id: 'S1', kind: 'exa' as const, trust: 'third_party' as const, url: 'https://example.com/', text: 'bar' }],
      deterministicContact: { instagram: 'elsotano.uy' },
      prominenceSignals: { instagramFollowers: 941 },
    }
    const byPrefix = postProcess(target, { ...extraction, doubts: ['Instagram rechazado: es una barbería.'] }, context)
    const byMention = postProcess(target, { ...extraction, contact: { ...extraction.contact, instagram: '' }, doubts: ['El Instagram oficial elsotano.uy corresponde a una barbería, no al bar.'] }, context)
    const kept = postProcess(target, { ...extraction, contact: { ...extraction.contact, instagram: '' }, doubts: ['Horario: las fuentes se contradicen.'] }, context)

    expect(byPrefix.contact.instagram).toBeNull()
    expect(byMention.contact.instagram).toBeNull()
    expect(byMention.signals.igFollowers).toBeNull()
    expect(kept.contact.instagram).toBe('elsotano.uy')
    // Nombrar el handle sin dejar el contacto vacío no es un rechazo.
    expect(instagramRejectedByModel({ contact: { ...extraction.contact, instagram: 'elsotano.uy' }, doubts: ['Horario tomado de elsotano.uy'] }, 'elsotano.uy')).toBe(false)
  })

  it('guarda el nombre sólo si una fuente citada lo dice, nunca el de Google', () => {
    const source: Source = { id: 'S1', kind: 'web', trust: 'official', url: 'https://cafe.example/', text: 'Café Brasilero Montevideo. Estamos en Ituzaingó 1447, Ciudad Vieja.' }
    const facts = [
      { id: 'F1', text: 'El local se llama Café Brasilero', sourceId: 'S1', kind: 'other' as const, proposedTag: null },
      { id: 'F2', text: 'Está en Ituzaingó 1447', sourceId: 'S1', kind: 'other' as const, proposedTag: null },
    ]
    const base = { ...emptyExtraction, facts, name: 'Café Brasilero' }

    const sourced = postProcess({ ...target, name: 'Nombre De Google', address: 'Dirección de Google 1' }, {
      ...base, support: [{ field: 'name', facts: ['F1'] }],
    }, { sources: [source] })
    expect(sourced.name).toBe('Café Brasilero')
    expect(sourced).not.toHaveProperty('address')
    expect(sourced.embeddingText).toContain('Café Brasilero')
    expect(sourced.embeddingText).not.toContain('Nombre De Google')
    expect(sourced.placeFacts.map((fact) => fact.supports)).toEqual([['name'], []])
    expect(reviewExtraction(sourced, base).doubts).toEqual([])

    // Sin support, o con un valor que no está en la fuente citada, no hay respaldo de Google
    // (cuando ninguna fuente nombra la marca de Google).
    const unknownBrand = { ...target, name: 'Nombre De Google' }
    const unsupported = postProcess(unknownBrand, base, { sources: [source] })
    expect(unsupported.name).toBe('')
    expect(postProcess(unknownBrand, {
      ...base, name: 'Otro Nombre', support: [{ field: 'name', facts: ['F1'] }],
    }, { sources: [source] }).name).toBe('')
    expect(reviewExtraction(unsupported, { ...base, doubts: ['d1', 'd2', 'd3', 'd4', 'd5'] }).doubts)
      .toEqual([MISSING_NAME_DOUBT, 'd1', 'd2', 'd3', 'd4'])
  })

  it('guarda la marca sin la sucursal si una fuente la nombra, aunque el modelo no la cite', () => {
    const exaSummary: Source = { id: 'S1', kind: 'exa', trust: 'third_party', url: 'https://exa.ai/', text: 'RESUMEN ESTRUCTURADO DE EXA\nDescripción: La Nueva Roma es una heladería artesanal' }
    const directory: Source = { id: 'S2', kind: 'exa', trust: 'third_party', url: 'https://guia.example/la-nueva-roma', text: 'La Nueva Roma, heladería artesanal desde 1963' }
    const branch = { ...target, name: 'La Nueva Roma Cordón' }
    const facts = [{ id: 'F1', text: 'La Nueva Roma es una heladería artesanal', sourceId: 'S1', kind: 'other' as const, proposedTag: null }]

    // El modelo devuelve el nombre con la sucursal y cita una fuente que sólo dice la marca.
    expect(postProcess(branch, {
      ...emptyExtraction, facts, name: 'La Nueva Roma Cordón', support: [{ field: 'name', facts: ['F1'] }],
    }, { sources: [exaSummary, directory] }).name).toBe('La Nueva Roma')

    // El modelo no cita el nombre: alcanza con que la web oficial nombre la marca.
    const web: Source = { id: 'S1', kind: 'web', trust: 'official', url: 'https://marca.example/', text: 'Home - LA NUEVA ROMA. Helados artesanales.' }
    expect(postProcess(branch, { ...emptyExtraction, name: 'La Nueva Roma' }, { sources: [web] }).name).toBe('La Nueva Roma')

    // El resumen de Exa sale de una búsqueda con ese nombre: solo no confirma la marca.
    const onlySummary = postProcess(branch, { ...emptyExtraction, facts, name: 'La Nueva Roma' }, { sources: [exaSummary] })
    expect(onlySummary.name).toBe('')
    expect(reviewExtraction(onlySummary, emptyExtraction).doubts).toContain(MISSING_NAME_DOUBT)
  })

  it('detecta sucursales de cadenas por la marca o por fuentes que muestran varias sucursales', () => {
    const page = (url: string, text: string): Source => ({ id: 'S1', kind: 'exa', trust: 'third_party', url, text })
    expect(isChainBranch({ name: 'La Nueva Roma Cordón' }, [])).toBe(true)
    expect(isChainBranch({ name: 'Freddo' }, [page('https://marca.example/', 'Conocé nuestras sucursales')])).toBe(true)
    expect(isChainBranch({ name: 'Freddo' }, [page('https://marca.example/store/pocitos/', 'Pocitos')])).toBe(true)
    expect(isChainBranch({ name: 'Café Brasilero' }, [page('https://cafe.example/', 'Café histórico de la Ciudad Vieja')])).toBe(false)
    // Un agregado descriptivo después del separador no es una sucursal.
    expect(isChainBranch({ name: 'The Lab Coffee Roasters | Museo Nacional de Artes Visuales' }, [])).toBe(false)
    expect(isChainBranch({ name: 'Freddo (Pocitos)' }, [])).toBe(true)
  })

  describe('sucursal de una cadena', () => {
    const branch = { ...target, name: 'Heladería Marca', address: 'Av. Gonzalo Ramírez 2051', neighborhoodId: 'CORDON' }
    const web: Source = { id: 'S1', kind: 'web', trust: 'official', url: 'https://marca.example/', text: 'Heladería Marca. Conocé nuestras sucursales.' }
    const otherBranch: Source = { id: 'S2', kind: 'exa', trust: 'third_party', url: 'https://guia.example/marca-shopping', text: 'Heladería Marca, Av. Luis Alberto de Herrera 1290. Tel 2622 0000. Lunes 10 a 22. Tiene terraza y wifi.' }
    const thisBranch: Source = { id: 'S3', kind: 'exa', trust: 'third_party', url: 'https://guia.example/marca-cordon', text: 'Heladería Marca en Cordón, Av. Gonzalo Ramírez 2051. Tel 2410 0000. Lunes 12 a 23. Tiene terraza.' }
    const fromSource = (sourceId: string): PlaceExtraction => ({
      ...emptyExtraction,
      facts: [{ id: 'F1', text: 'Horario, terraza y wifi', sourceId, kind: 'other', proposedTag: null }],
      tags: [{ group: 'features', id: 'terrace', facts: ['F1'] }, { group: 'features', id: 'wifi', facts: ['F1'] }],
      hours: { raw: 'Lunes', display: null, blocks: [{ days: [1], opens: '10:00', closes: '22:00' }] },
      contact: { instagram: 'heladeriamarca', website: 'https://marca.example/' },
      support: ['hours', 'contact.website', 'contact.instagram'].map((field) => ({ field, facts: ['F1'] })),
    })

    it('descarta horario y features físicos que vienen de otra sucursal', () => {
      const place = postProcess(branch, fromSource('S2'), { sources: [web, otherBranch] })
      expect(place.hours).toMatchObject({ status: 'none', slots: [], missingReason: 'chain_branch_not_found' })
      // Web e Instagram son de la marca: se mantienen aunque ninguna fuente confirme la sucursal.
      expect(place.contact).toEqual({ website: 'https://marca.example/', instagram: 'heladeriamarca' })
      // terrace depende del local; wifi es de la marca y se mantiene.
      expect(place.tags).not.toContain('terrace')
      expect(place.tags).toContain('wifi')
    })

    it('los acepta si la fuente menciona la dirección o el barrio de esta sucursal', () => {
      const place = postProcess(branch, fromSource('S3'), { sources: [web, otherBranch, thisBranch] })
      expect(place.hours.status).toBe('exact')
      expect(place.tags).toEqual(expect.arrayContaining(['terrace', 'wifi']))

      const byNeighborhood: Source = { ...thisBranch, text: 'Heladería Marca, sucursal Cordón. Lunes 12 a 23. Tiene terraza.' }
      const fromNeighborhood = postProcess(branch, fromSource('S3'), { sources: [web, byNeighborhood] })
      expect(fromNeighborhood.hours.status).toBe('exact')
      expect(fromNeighborhood.tags).toContain('terrace')
    })

    // Plaza de Chueca / Costa Azul: el nombre de Google no dice sucursal, pero hay otro lugar guardado de la marca.
    const plainWeb: Source = { ...web, text: 'Heladería Marca. Helados artesanales.' }
    it('con knownChain aplica las reglas de sucursal aunque ni el nombre ni las fuentes muestren sucursales', () => {
      const data = fromSource('S2')
      expect(postProcess(branch, data, { sources: [plainWeb, otherBranch] }).hours.status).toBe('exact')
      const place = postProcess(branch, data, { sources: [plainWeb, otherBranch], knownChain: true })
      expect(place.signals.chainBranch).toBe(true)
      expect(place.hours.slots).toEqual([])
      // Lo de la marca queda.
      expect(place.contact).toMatchObject({ website: 'https://marca.example/', instagram: 'heladeriamarca' })
      expect(place.tags).toContain('wifi')
    })
  })

  describe('páginas que listan varios locales', () => {
    // Directorio real de pocitospuntacarretas.com (recortado): MOB recibió de acá el teléfono de El Viejo Sosa.
    const directory: Source = {
      id: 'S1', kind: 'exa', trust: 'third_party', url: 'https://www.pocitospuntacarretas.com/directorio.php?c=9.0',
      text: 'Gastronomía | Pocitos Punta Carretas\n\nLa Kanti \n\n Francisco Ros 2748, Montevideo, Uruguay \n\nEl Viejo Sosa\n\n Coronel Mora 603, 11300 \n\n| 2712 6737 |\n| --- |\n\nVera \n\n Agr Francisco Ros 2758, 11300 \n\n| 098 462 655 |\n| --- |\n\nPomelo\n\n Miñones 461, Montevideo, Uruguay 11300\n\nLa Croissantería \n\n José Ellauri 534, Montevideo, Uruguay 11300\n\n| 2712 0777 | Sitio web |\n| --- | --- |',
    }
    it('reconoce el directorio por la ruta o por tener 3+ teléfonos; una ficha de un solo local, no', () => {
      expect(isListingSource(directory, 'MOB')).toBe(true)
      expect(isListingSource({ ...directory, url: 'https://guia.example/lugares' }, 'MOB')).toBe(true)
      expect(isListingSource({ id: 'S2', kind: 'exa', trust: 'third_party', url: 'https://www.rappi.com.uy/restaurantes/1-negroni', text: 'Negroni · Guipuzcoa 352 · Tel 2716 7903 · WhatsApp 093 661 919' }, 'Negroni')).toBe(false)
    })

    it('la web de la marca y la ficha del lugar no son listados aunque muestren varios teléfonos', () => {
      // Don Peperone lista sus sucursales; la ficha de guiacomercial muestra locales cercanos.
      expect(isListingSource({ ...directory, url: 'https://donpeperone.com.uy/' }, 'Don Peperone')).toBe(false)
      expect(isListingSource({ ...directory, url: 'https://guiacomercial.uy/ficha/grasa-burger-club-montevideo/' }, 'Grasa Burger Club')).toBe(false)
      expect(isListingSource({ ...directory, url: 'https://salimos.uy/listado/vereda/' }, 'Vereda')).toBe(false)
      expect(isListingSource({ ...directory, url: 'https://montevideo.evisos.com.uy/restaurantes-bares-sc-158-p-3' }, 'Impulsus')).toBe(true)
    })

    it('el texto del lugar es el renglón de la marca y los que le siguen', () => {
      expect(placeText(directory, 'El Viejo Sosa')).toContain('2712 6737')
      expect(placeText(directory, 'MOB')).toBe('')
      // Pomelo no tiene teléfono en el directorio: no se lleva el de La Croissantería, que viene después.
      expect(placeText(directory, 'Pomelo')).toContain('Miñones 461')
      expect(placeText(directory, 'Pomelo')).not.toContain('2712 0777')
    })

    it('la web del modelo citada de un directorio sólo vale junto a la marca', () => {
      const withWeb: Source = { ...directory, text: directory.text.replace('| 2712 6737 |', '| 2712 6737 | elviejososa.com.uy |') }
      const data = {
        ...emptyExtraction,
        facts: [{ id: 'F1', text: 'La web es elviejososa.com.uy', sourceId: 'S1', kind: 'contact' as const, proposedTag: null }],
        contact: { instagram: '', website: 'https://elviejososa.com.uy/' },
        support: [{ field: 'contact.website', facts: ['F1'] }],
      }
      expect(postProcess({ ...target, name: 'MOB Punta Carretas' }, data, { sources: [withWeb] }).contact.website).toBeNull()
      expect(postProcess({ ...target, name: 'El Viejo Sosa' }, data, { sources: [withWeb] }).contact.website).toBe('https://elviejososa.com.uy/')
    })
  })

  it('valida los teléfonos como números de Uruguay: un CEP brasileño no es un teléfono', () => {
    const phoneIn = (text: string) => phonesInText(text)[0] ?? null
    expect(phoneIn('Porto Alegre - RS, 90035-077')).toBeNull()
    expect(phoneIn('Tel. 2710-7913')).toBe('+598 2710 7913')
    expect(phoneIn('Celular 092 207 690')).toBe('+598 92 207 690')
    expect(phoneIn('Local en Maldonado: 4222 1234')).toBe('+598 4222 1234')
    expect(phoneIn('Buenos Aires: +54 11 4444 5555')).toBeNull()
    // Número corto (UAN): válido para libphonenumber, pero no es el teléfono de un local.
    expect(phoneIn('Llamá al 2110')).toBeNull()
  })

  it('una fecha no es un teléfono aunque libphonenumber la valide', () => {
    const phoneIn = (text: string) => phonesInText(text)[0] ?? null
    // Kumpir (post de LinkedIn) y Marlon Bar (fecha de una reseña en guiacomercial).
    expect(phoneIn('- [2026-05-25 · 23 reactions] Hace menos de 2 años')).toBeNull()
    expect(phoneIn('Ana\n ★★★★★ 26.11.2025 \nHermoso lugar')).toBeNull()
    expect(phoneIn('Publicado 25-05-2026')).toBeNull()
    expect(phoneIn('Abierto 2019-2024')).toBeNull()
    for (const [text, phone] of [['Tel. 2710-7913', '+598 2710 7913'], ['2410 1234', '+598 2410 1234'], ['Celular 092 207 690', '+598 92 207 690'], ['+598 2402 0525', '+598 2402 0525']]) {
      expect(phoneIn(text), text).toBe(phone)
    }
    expect(phoneIn('Reseña del 2026-05-25. Reservas al 2710-7913')).toBe('+598 2710 7913')
  })

  it('las fechas de las reseñas no hacen de una ficha un listado', () => {
    const card: Source = { id: 'S1', kind: 'exa', trust: 'third_party', url: 'https://guia.example/lugar/123', text: 'Tel 2710 7913\n★ 26.11.2025\n★ 12.10.2025\n★ 2026-01-05' }
    expect(isListingSource(card, 'Marlon Bar')).toBe(false)
  })

  it('completa la web con la home de la web oficial scrapeada, salvo que el modelo traiga una con respaldo', () => {
    const official: Source = { id: 'S1', kind: 'web', trust: 'official', url: 'http://www.cafe.example/carta/menu.html?x=1', text: 'Carta del café. Web: https://cafe-oficial.example/' }
    const data = { ...emptyExtraction, facts: [{ id: 'F1', text: 'La web es https://cafe-oficial.example/', sourceId: 'S1', kind: 'contact' as const, proposedTag: null }], contact: { website: 'https://cafe-oficial.example/', instagram: '' } }

    expect(postProcess(target, data, { sources: [official] }).contact.website).toBe('https://www.cafe.example/')
    expect(postProcess(target, { ...data, support: [{ field: 'contact.website', facts: ['F1'] }] }, { sources: [official] }).contact.website).toBe('https://cafe-oficial.example/')
    expect(officialWebsiteHome([{ ...official, trust: 'third_party' }])).toBeNull()
    expect(officialWebsiteHome([{ ...official, url: 'https://oriundo.meitre.com/' }, { ...official, url: 'https://linktr.ee/cafe' }])).toBeNull()
    expect(officialWebsiteHome([{ ...official, kind: 'instagram', url: 'https://instagram.com/cafe/' }])).toBeNull()
  })

  it('mantiene horarios y highlights aislados al extraer Namasté, Culto Café y Oriundo en secuencia', async () => {
    const fixtures = {
      'Namasté': {
        highlights: [{ es: 'sorrentinos', en: 'sorrentinos' }],
        hoursRaw: 'Tue-Sun 12:00-15:30 y 19:00-00:30',
        blocks: [
          { days: [0, 2, 3, 4, 5, 6], opens: '12:00', closes: '15:30' },
          { days: [0, 2, 3, 4, 5, 6], opens: '19:00', closes: '00:30' },
        ],
      },
      'Culto Café': {
        highlights: [{ es: 'crepe de cacao', en: 'cocoa crepe' }],
        hoursRaw: 'Mon 09:00-18:00',
        blocks: [{ days: [1], opens: '09:00', closes: '18:00' }],
      },
      Oriundo: {
        highlights: [{ es: 'tartín de temporada', en: 'seasonal tartin' }],
        hoursRaw: 'Fri-Sat 19:00-01:00',
        blocks: [{ days: [5, 6], opens: '19:00', closes: '01:00' }],
      },
    } as const
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: {
        getDetails: async (placeId) => {
          const name = placeId.replace('-place', '') as keyof typeof fixtures
          return { ...googleDetails, anchor: { ...googleDetails.anchor, name } }
        },
      },
      exa: {
        configured: true,
        searchPlace: async (name) => {
          // Culto Café lleva el barrio en la consulta (marca corta).
          const fixture = fixtures[(Object.keys(fixtures) as (keyof typeof fixtures)[]).find((key) => name.startsWith(key))!]
          const response = exaResponse()
          return {
            ...response,
            output: {
              content: {
                ...response.output.content,
                description: fixture.highlights.map((highlight) => highlight.es).join('. '),
                open_hours_raw: fixture.hoursRaw,
              },
              grounding: {},
            },
          }
        },
      },
      generate: async (generatedTarget) => {
        const fixture = fixtures[generatedTarget.name as keyof typeof fixtures]
        return {
          ...emptyExtraction,
          facts: [{ id: 'F1', text: `abre ${fixture.hoursRaw}`, sourceId: 'S1', kind: 'hours' as const, proposedTag: null }],
          highlights: fixture.highlights.map((highlight) => ({ ...highlight, facts: ['F1'] })),
          hours: { raw: fixture.hoursRaw, display: null, blocks: fixture.blocks.map((block) => ({ ...block, days: [...block.days] })) },
          support: [{ field: 'hours', facts: ['F1'] }],
        }
      },
    })

    for (const name of ['Namasté', 'Culto Café', 'Oriundo'] as const) {
      const response = await service.extract(`${name}-place`, { seedCategories: ['restaurant'] })
      expect(response).toMatchObject({ status: 'ok', place: { highlights: fixtures[name].highlights } })
      if (response.status !== 'ok') throw new Error(`${name} sin status ok`)
      expect(response.place.hours.slots).toHaveLength(name === 'Namasté' ? 12 : name === 'Culto Café' ? 1 : 2)
    }
  })

  it('mantiene Oriundo estable en tres extracciones seguidas, sin cache', async () => {
    let runs = 0
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => ({
        ...googleDetails,
        anchor: { ...googleDetails.anchor, name: 'Oriundo' },
        websiteUri: 'https://oriundo.meitre.com/',
        phoneNumber: null,
      }) },
      exa: { configured: true, searchPlace: async () => ({
        ...exaResponse(),
        query: 'Oriundo, Montevideo, Uruguay',
        output: { content: { ...exaResponse().output.content, contact_info: 'Reservas: https://oriundo.meitre.com/ · Instagram: @magnolio.uy · Correo: @oriundo.uy · wine bar' }, grounding: {} },
      }) },
      generate: async () => {
        runs += 1
        return {
          ...emptyExtraction,
          facts: [{ id: 'F1', text: 'es un wine bar', sourceId: 'S1', kind: 'other' as const, proposedTag: null }],
          tags: runs % 2 ? [{ group: 'categories' as const, id: 'wine_bar', facts: ['F1'] }] : [],
          contact: { ...extraction.contact, instagram: 'magnolio.uy' },
          support: [],
        }
      },
    })

    const responses = []
    for (let index = 0; index < 3; index += 1) {
      responses.push(await service.extract('oriundo-place', { seedCategories: ['bar'] }))
    }
    for (const response of responses) {
      expect(response).toMatchObject({
        status: 'ok',
        place: { categories: expect.arrayContaining(['bar']), contact: { instagram: 'oriundo.uy' }, reservations: 'accepts' },
      })
    }
    expect(runs).toBe(3)
  })

  it('el prompt lista cada categoría de ícono con su descripción y el esquema sólo pide la clave', () => {
    for (const [key, { description }] of Object.entries(ICON_CATEGORIES)) expect(SYSTEM_PROMPT).toContain(`- ${key}: ${description}`)
    expect(SYSTEM_PROMPT).toContain('una pizzería que vende cerveza es pizza')
    expect(SYSTEM_PROMPT).toContain('En una cadena, la categoría es de la marca')
    // Sin genérico: el modelo siempre elige la categoría real más cercana.
    expect(SYSTEM_PROMPT).toContain('Elegí siempre la categoría más cercana, aunque no sea exacta.')
    expect(SYSTEM_PROMPT).not.toContain('- other:')
    expect(PlaceExtraction.shape.iconCategory.options).toEqual(ICON_CATEGORY_KEYS)
    expect(PlaceExtraction.shape.iconCategory.options).not.toContain('other')
    expect(PlaceExtraction.safeParse({ ...extraction, iconCategory: 'other' }).success).toBe(false)
    expect(PlaceExtraction.safeParse({ ...extraction, iconCategory: 'nope' }).success).toBe(false)
  })

  it('la categoría de ícono del modelo llega al draft, también en una sucursal de cadena', () => {
    const sources = [{ id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://cafe.example/sucursales', text: 'Café de especialidad. Nuestras sucursales' }]
    const place = postProcess(target, { ...extraction, iconCategory: 'croissant' }, { sources })

    expect(isChainBranch(target, sources)).toBe(true)
    expect(place.iconCategory).toBe('croissant')
  })

  it('pide facts primero y no trae ejemplos de lugares ni platos reales en el prompt', () => {
    expect(SYSTEM_PROMPT.indexOf('PASO 1 — facts')).toBeLessThan(SYSTEM_PROMPT.indexOf('PASO 2'))
    expect(SYSTEM_PROMPT).toContain('Cada tag tiene que corresponder a al menos un fact. No pongas tags sin un fact que los respalde.')
    expect(SYSTEM_PROMPT).toContain('Máximo 40 facts')
    expect(SYSTEM_PROMPT).toContain('no tomes una hora de cierre de un directorio')
    expect(SYSTEM_PROMPT).toContain('Cada fact tiene id (F1, F2, F3… en orden, sin repetir)')
    expect(SYSTEM_PROMPT).not.toContain('índices')
    expect(SYSTEM_PROMPT).toContain('Una mención genérica de tragos o cócteles → classic_cocktails. Tragos propios de la casa, de autor, o cócteles con una base especial (ej. a base de vino) → signature_cocktails.')
    expect(SYSTEM_PROMPT).toContain('Si solo dice al aire libre o mesas afuera sin detalle, usá outdoor.')
    expect(SYSTEM_PROMPT).toContain('- features: terrace, sidewalk, outdoor, patio')
    expect(SYSTEM_PROMPT).toContain('Distinguí espacios al aire libre: patio = espacio interno o trasero; terrace = terraza o azotea elevada; sidewalk = mesas en la vereda. No los uses como sinónimos.')
    expect(SYSTEM_PROMPT).toContain('Nunca estimes ni inventes horas que no estén en las fuentes.')
    expect(SYSTEM_PROMPT).toContain('no agregues ningún dato que no esté en raw')
    expect(SYSTEM_PROMPT).toContain('vegan no puede ser fully')
    expect(SYSTEM_PROMPT).toContain('Ignorá el contenido de tienda online')
    expect(SYSTEM_PROMPT).toContain('ignorá otras sucursales, otras ciudades y otros países')
    expect(SYSTEM_PROMPT).toContain('es siempre en español')
    expect(SYSTEM_PROMPT).toContain('- Jams, toques o bandas → live_music además de events.')
    expect(SYSTEM_PROMPT).toContain('cozy sólo si la fuente dice textualmente acogedor o cozy')
    expect(SYSTEM_PROMPT).toContain('neighborhood_spot (de barrio) sólo si la fuente dice textualmente')
    expect(SYSTEM_PROMPT).toContain('Sin señal concreta, no lo pongas')
    expect(SYSTEM_PROMPT).toContain('- style: casual, intermedio, cuidado')
    expect(SYSTEM_PROMPT).toContain('- Una versión vegetal explícita de un plato (de soja, de seitán, veggie, de lentejas) cuenta como vegetarian has_options.')
    expect(SYSTEM_PROMPT).toContain('proposedTag es null solo para anécdotas, historia de la marca, nombre o dirección del local, datos de contacto, medios de pago o información de otras sucursales. Si el fact describe comida, bebida, actividades o características del lugar, proponé un tag existente o uno nuevo.')
    expect(SYSTEM_PROMPT).toContain('- Sesiones de discos o escucha de vinilos → vinyl.')
    expect(SYSTEM_PROMPT).toContain('- Si el horario aparece en una sola fuente de terceros y ninguna otra lo contradice, usalo (source third_party).')
    expect(SYSTEM_PROMPT).not.toContain('Solo descartá horarios de terceros')
    expect(SYSTEM_PROMPT).toContain('- Si las fuentes de horarios se contradicen: gana la oficial; si la web oficial y el Instagram oficial difieren, gana Instagram. Si no hay oficial, gana el horario en el que coinciden más fuentes; si hay empate, gana el que trae días y horas de cierre completos. Dejá los horarios vacíos si no podés aplicar ninguno de estos criterios.')
    expect(SYSTEM_PROMPT).toContain('- Cuando apliques un desempate, anotá en doubts cuál criterio usaste')
    expect(SYSTEM_PROMPT).toContain('- Los facts de fuentes de terceros son válidos para tags de comida, bebida, características y momentos. Solo dietary necesita una mención explícita, y si una fuente oficial contradice a un tercero, gana la oficial.')
    expect(SYSTEM_PROMPT).toContain('- Platos concretos siempre se mapean a un tag: cortes de carne o achuras → grilled_meat;')
    expect(SYSTEM_PROMPT).toContain('Transmisiones deportivas → el tag de pantallas para fútbol (watch_football).')
    expect(SYSTEM_PROMPT).toContain('- Platos y bebidas concretos nunca van con proposedTag null: mapealos al tag más cercano (tapas o platos pequeños → tapas, y además picada si mencionan tablas, fiambres o quesos para compartir; postres dulces → desserts; jugos o licuados → smoothies; yogur, tostadas o similares → breakfast).')
    expect(SYSTEM_PROMPT).toMatch(/- foods: .*picada, tapas/)
    expect(SYSTEM_PROMPT).toMatch(/- goodFor: .*lgbtq_friendly/)
    expect(SYSTEM_PROMPT).toMatch(/- features: .*shop/)
    expect(SYSTEM_PROMPT).toMatch(/- features: .*events, books, dancing/)
    expect(HOURS_RETRY_PROMPT).toContain('Solo usá horarios que correspondan a la sucursal de esta dirección. Si la fuente lista varias sucursales, elegí la que coincide con la dirección. Si no podés confirmar la sucursal, devolvé vacío.')
    expect(SYSTEM_PROMPT).toContain('- doubts: anotá en doubts lo que no supiste resolver (máx. 5). No inventes dudas.')
    expect(SYSTEM_PROMPT).toContain('- Si las fuentes dicen que el local está dentro de otro lugar (shopping, mercado, galería, hotel, museo, polo gastronómico), completá locatedIn con el nombre de ese lugar. Si no lo dicen claramente, null. No lo deduzcas solo de la dirección.')
    expect(SYSTEM_PROMPT).toContain('- Si completás locatedIn, citá en support los facts que lo dicen, con field locatedIn.')
    expect(SYSTEM_PROMPT).toContain('- Si una fuente dice que solo se paga en efectivo, usá cash_only.')
    expect(SYSTEM_PROMPT).toContain('kids_friendly: fuertes: menú infantil, sillas altas, juegos o espacio para niños.')
    for (const example of ['Oriundo', 'Culto', 'Namasté', 'Palenque', 'Berracos', 'Oviedo', 'Galician', 'Feira', 'Padrón', 'polenta', 'canilla', ['can', 'elones'].join('')]) {
      expect(SYSTEM_PROMPT.toLowerCase()).not.toContain(example.toLowerCase())
    }
  })

  it('valida los bloques de horario y descarta los inválidos', () => {
    expect(slotsFromBlocks([
      { days: [2, 3], opens: '12:00', closes: '15:30' },
      { days: [2], opens: '12:00', closes: '15:30' },
      { days: [6], opens: '9:00', closes: '24:00' },
      { days: [0, 7], opens: '10:00', closes: '14:00' },
      { days: [], opens: '10:00', closes: '14:00' },
      { days: [1], opens: '', closes: '14:00' },
      { days: [1], opens: '10:00', closes: '2 AM' },
      { days: [5], opens: '18:00', closes: null },
    ])).toEqual([
      { day: 2, opens: '12:00', closes: '15:30' },
      { day: 3, opens: '12:00', closes: '15:30' },
      { day: 5, opens: '18:00', closes: null },
      { day: 6, opens: '09:00', closes: '00:00' },
    ])
  })

  it('calcula status, display y source de los horarios desde los bloques del modelo', () => {
    const official = { id: 'S1', kind: 'instagram' as const, trust: 'official' as const, url: 'https://www.instagram.com/local/', text: 'Abrimos todos los días a partir de 18hs' }
    const exa = { id: 'S2', kind: 'exa' as const, trust: 'third_party' as const, url: 'https://exa.ai/', text: 'Abre de martes a domingo' }
    const withHours = (hours: PlaceExtraction['hours'], sourceId: string, cite = true) => postProcess(target, {
      ...emptyExtraction,
      facts: [{ id: 'F1', text: 'abre todos los días desde las 18', sourceId, kind: 'hours', proposedTag: null }],
      hours,
      support: cite ? [{ field: 'hours.blocks.0', facts: ['F1'] }] : [],
    }, { sources: [official, exa] })

    const openEnded = withHours({
      raw: 'todos los días a partir de 18hs',
      display: { es: 'Todos los días de 18:00 a 02:00', en: 'Every day 6 PM–2 AM' },
      blocks: [{ days: [0, 1, 2, 3, 4, 5, 6], opens: '18:00', closes: null }],
    }, 'S1')
    expect(openEnded.hours).toEqual({
      raw: 'todos los días a partir de 18hs',
      slots: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, opens: '18:00', closes: null })),
      display: { es: 'Todos los días desde las 18:00', en: 'Every day from 18:00' },
      status: 'partial',
      source: 'official',
      missingReason: null,
    })

    const exact = withHours({ raw: 'Mar a dom 12 a 15:30', display: null, blocks: [{ days: [2, 3, 4, 5, 6, 0], opens: '12:00', closes: '15:30' }] }, 'S2')
    expect(exact.hours).toMatchObject({ status: 'exact', source: 'third_party', display: { es: 'Martes a domingo: 12:00–15:30', en: 'Tuesday to Sunday: 12:00–15:30' } })

    const vague = withHours({ raw: 'Abrimos de noche', display: { es: 'De noche', en: 'At night' }, blocks: [] }, 'S1')
    expect(vague.hours).toEqual({ raw: 'Abrimos de noche', slots: [], display: { es: 'De noche', en: 'At night' }, status: 'vague', source: 'official', missingReason: 'no_data' })

    const unsupported = withHours({ raw: 'Lunes 9 a 18', display: null, blocks: [{ days: [1], opens: '09:00', closes: '18:00' }] }, 'S1', false)
    expect(unsupported.hours).toEqual({ raw: null, slots: [], display: null, status: 'none', source: null, missingReason: 'no_data' })
  })

  it('conserva sólo los datos que citan un fact válido', () => {
    const source = { id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://local.example/', text: 'Pizzas a la leña y DJ los viernes' }
    const place = postProcess(target, {
      ...emptyExtraction,
      facts: [
        { id: 'F1', text: 'hace pizzas a la leña', sourceId: 'S1', kind: 'food', proposedTag: null },
        { id: 'F2', text: 'pone DJ los viernes', sourceId: 'S1', kind: 'feature', proposedTag: null },
        { id: 'F3', text: 'acepta reservas', sourceId: 'S9', kind: 'reservations', proposedTag: null },
      ],
      tags: [
        { group: 'categories', id: 'pizzeria', facts: ['F1'] }, { group: 'categories', id: 'bar', facts: [] },
        { group: 'foods', id: 'pizza', facts: ['F1'] }, { group: 'foods', id: 'pasta', facts: [] }, { group: 'foods', id: 'id_inventado', facts: ['F1'] },
        { group: 'foods', id: 'constructor', facts: ['F1'] },
        { group: 'features', id: 'dj', facts: ['F2', 'F100'] }, { group: 'features', id: 'pizza', facts: ['F1'] },
        { group: 'goodFor', id: 'work', facts: [] },
      ],
      dietary: { vegan: 'has_options', vegetarian: 'unknown', glutenFree: 'unknown' },
      price: 'high',
      reservations: 'accepts',
      contact: { instagram: '', website: 'https://local.example/' },
      support: [
        { field: 'reservations', facts: ['F3'] },
        { field: 'contact.website', facts: ['F1'] },
      ],
    }, { sources: [source] })

    expect(place.categories).toEqual(['pizzeria', 'restaurant'])
    expect(place.tags).toEqual(expect.arrayContaining(['pizza', 'dj']))
    expect(place.tags).not.toContain('pasta')
    expect(place.tags).not.toContain('work')
    expect(place.dietary.vegan).toBe('unknown')
    expect(place.price).toBe('unknown')
    expect(place.reservations).toBe('unknown')
    expect(place.contact).toMatchObject({ website: 'https://local.example/' })
  })

  it('un website de reservas o de WhatsApp no queda como web; el de reservas, con support, dice que toma reservas', () => {
    expect(classifyContact({ instagram: null, website: 'https://local.meitre.com/' })).toEqual({ instagram: null, website: null })
    expect(classifyContact({ instagram: null, website: 'https://wa.me/59899111222' })).toEqual({ instagram: null, website: null })
    const data: PlaceExtraction = {
      ...emptyExtraction,
      facts: [{ id: 'F1', text: 'reserva por Meitre', sourceId: 'S1', kind: 'reservations', proposedTag: null }],
      contact: { instagram: '', website: 'https://local.meitre.com/' },
      support: [{ field: 'contact.website', facts: ['F1'] }],
    }
    const sources: Source[] = [{ id: 'S1', kind: 'web', trust: 'official', url: 'https://local.example/', text: 'Reservas por Meitre' }]
    const place = postProcess(target, data, { sources })
    // website queda con la home de la web oficial scrapeada; el link de reservas no se guarda.
    expect(place.contact).toEqual({ instagram: null, website: 'https://local.example/' })
    expect(place.reservations).toBe('accepts')
    expect(postProcess(target, { ...data, support: [] }, { sources }).reservations).toBe('unknown')
  })

  it('devuelve placeFacts con id y lo que respalda cada uno, hasta 40, y sin usarlos para la búsqueda', () => {
    const sources = [
      { id: 'S1', kind: 'instagram' as const, trust: 'official' as const, url: 'https://www.instagram.com/local/', text: 'DJ los viernes' },
      { id: 'S2', kind: 'exa' as const, trust: 'third_party' as const, url: 'https://exa.ai/', text: 'Resumen' },
    ]
    const facts = Array.from({ length: 45 }, (_, index) => ({ id: `F${index + 1}`, text: `fact ${index} FACT_NO_EN_BUSQUEDA`, sourceId: index === 1 ? 'S2' : 'S1', kind: 'other' as const, proposedTag: null }))
    facts[2] = { id: 'F3', text: 'fact inválido', sourceId: 'S7', kind: 'other', proposedTag: null }
    facts[3] = { id: 'F1', text: 'fact con id repetido', sourceId: 'S1', kind: 'other', proposedTag: null }
    const place = postProcess(target, {
      ...emptyExtraction,
      facts,
      tags: [{ group: 'features', id: 'dj', facts: ['F1', 'F2', 'F99'] }, { group: 'categories', id: 'bar', facts: ['F2'] }],
    }, { sources })

    // 40 facts como máximo, menos el de fuente inexistente y el de id repetido.
    expect(place.placeFacts).toHaveLength(38)
    expect(place.placeFacts[0]).toEqual({
      id: 'F1', text: 'fact 0 FACT_NO_EN_BUSQUEDA', kind: 'other', sourceId: 'S1', sourceUrl: 'https://www.instagram.com/local/', trust: 'official', supports: ['features.dj'],
    })
    expect(place.placeFacts[1]).toMatchObject({ id: 'F2', sourceId: 'S2', trust: 'third_party', supports: ['features.dj', 'categories.bar'] })
    expect(place.placeFacts.some((fact) => fact.text === 'fact inválido' || fact.text === 'fact con id repetido')).toBe(false)
    expect(place.embeddingText).not.toContain('FACT_NO_EN_BUSQUEDA')
    expect(place.keywordText).not.toContain('FACT_NO_EN_BUSQUEDA')
  })

  it('guarda locatedIn citando su fact y lo suma a los textos de búsqueda', () => {
    const source = { id: 'S1', kind: 'web' as const, trust: 'third_party' as const, url: 'https://guia.example/', text: 'Parrilla en el Mercado del Puerto.' }
    const data: PlaceExtraction = {
      ...emptyExtraction,
      facts: [{ id: 'F1', text: 'Está en el Mercado del Puerto', sourceId: 'S1', kind: 'other', proposedTag: null }],
      locatedIn: '  Mercado del Puerto ',
      support: [{ field: 'locatedIn', facts: ['F1'] }],
    }
    const inside = postProcess(target, data, { sources: [source] })
    expect(inside.locatedIn).toBe('Mercado del Puerto')
    expect(inside.embeddingText).toContain('Dentro de Mercado del Puerto')
    expect(inside.keywordText).toContain('Dentro de Mercado del Puerto')
    expect(inside.placeFacts[0].supports).toEqual(['locatedIn'])
    expect(reviewExtraction(inside, data).unmappedFacts).toEqual([])

    // Sin un fact válido que lo respalde, o con nombre vacío, se descarta.
    const uncited = postProcess(target, { ...data, support: [{ field: 'locatedIn', facts: ['F9'] }] }, { sources: [source] })
    expect(uncited.locatedIn).toBeNull()
    expect(uncited.embeddingText).not.toContain('Dentro de')
    expect(reviewExtraction(uncited, data).unmappedFacts.map((item) => item.id)).toEqual(['F1'])
    const blank = postProcess(target, { ...data, locatedIn: '   ' }, { sources: [source] })
    expect(blank.locatedIn).toBeNull()
  })

  it('aplica las reglas que no dependen de palabras: categorías, horarios y dietary', () => {
    const source = { id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://local.example/', text: 'Fuente' }
    const grill = postProcess(target, {
      ...emptyExtraction,
      facts: [{ id: 'F1', text: 'abre de 12 a 03', sourceId: 'S1', kind: 'hours', proposedTag: null }],
      tags: [{ group: 'moments', id: 'late_night', facts: ['F1'] }],
      hours: { raw: 'Viernes de 12 a 03', display: null, blocks: [{ days: [5], opens: '12:00', closes: '03:00' }] },
      support: [{ field: 'hours', facts: ['F1'] }],
    }, { sources: [source], seedCategories: ['grill'] })
    expect(grill.categories).toEqual(['grill', 'restaurant'])
    expect(grill.tags).toEqual(expect.arrayContaining(['grilled_meat', 'uruguayan', 'lunch', 'dinner', 'late_night']))

    const modelLateNight = postProcess(target, {
      ...emptyExtraction,
      facts: [{ id: 'F1', text: 'abre hasta tarde', sourceId: 'S1', kind: 'hours', proposedTag: null }],
      tags: [{ group: 'moments', id: 'late_night', facts: ['F1'] }],
      hours: { raw: 'Viernes de 19 a 01', display: null, blocks: [{ days: [5], opens: '19:00', closes: '01:00' }] },
      support: [{ field: 'hours', facts: ['F1'] }],
    }, { sources: [source], seedCategories: ['bar'] })
    expect(modelLateNight.tags).not.toContain('late_night')
    expect(modelLateNight.tags).toContain('drinks')

    const cafe = postProcess(target, emptyExtraction, { sources: [source], seedCategories: ['cafe'] })
    expect(cafe.tags).toEqual(expect.arrayContaining(['breakfast', 'afternoon_snack']))

    const vegetarianGrill = postProcess(target, {
      ...emptyExtraction,
      facts: [{ id: 'F1', text: 'todo el menú es vegano', sourceId: 'S1', kind: 'dietary', proposedTag: null }],
      dietary: { vegan: 'fully', vegetarian: 'unknown', glutenFree: 'unknown' },
      support: [{ field: 'dietary.vegan', facts: ['F1'] }],
    }, { sources: [source], seedCategories: ['grill'] })
    expect(vegetarianGrill.dietary).toMatchObject({ vegan: 'fully', vegetarian: 'fully' })
    expect(vegetarianGrill.tags).not.toContain('grilled_meat')
  })

  it('descarta highlights sin fact válido o que no aparecen en las fuentes, y deja como máximo ocho', () => {
    const source = { id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://local.example/', text: Array.from({ length: 10 }, (_, index) => `plato ${index}`).join('. ') }
    const place = postProcess(target, {
      ...emptyExtraction,
      facts: [{ id: 'F1', text: 'la carta tiene platos', sourceId: 'S1', kind: 'food', proposedTag: null }],
      highlights: [
        { es: 'plato inventado', en: 'made up dish', facts: ['F1'] },
        { es: 'plato 9', en: 'dish 9', facts: [] },
        { es: 'plato 8', en: 'dish 8', facts: ['F7'] },
        ...Array.from({ length: 10 }, (_, index) => ({ es: `plato ${index}`, en: `dish ${index}`, facts: ['F1'] })),
      ],
    }, { sources: [source] })
    expect(place.highlights).toHaveLength(8)
    expect(place.highlights[0]).toEqual({ es: 'plato 0', en: 'dish 0' })
  })

  it('revisa facts sin mapear, dudas del modelo y anomalías de horarios, bebidas y contacto', () => {
    // De terceros: con una web oficial, website se completaría y no habría anomalía no_contact.
    const source = { id: 'S1', kind: 'directory' as const, trust: 'third_party' as const, url: 'https://guia.example/bar', text: 'Abrimos todos los días desde las 18. Probá el flat white. Mesa de ping pong.' }
    const data: PlaceExtraction = {
      ...emptyExtraction,
      facts: [
        { id: 'F1', text: 'Abre todos los días desde las 18:00', sourceId: 'S1', kind: 'hours', proposedTag: null },
        { id: 'F2', text: 'Sirve flat white', sourceId: 'S1', kind: 'drink', proposedTag: null },
        // proposedTag: un id nuevo en snake_case se conserva; uno inválido cuenta como null.
        { id: 'F3', text: 'Mesa de ping pong', sourceId: 'S1', kind: 'feature', proposedTag: 'ping_pong' },
        { id: 'F4', text: 'Tiene un Lemon con la receta de la abuela', sourceId: 'S1', kind: 'drink', proposedTag: 'Receta Abuela!' },
      ],
      // Un id que no existe en tags.ts no cuenta como mapeo: F3 tiene que aparecer en el reporte.
      tags: [{ group: 'features', id: 'ping_pong', facts: ['F3'] }],
      highlights: [{ es: 'flat white', en: 'flat white', facts: ['F2'] }],
      hours: { raw: 'Todos los días desde las 18', display: null, blocks: [{ days: [0, 1, 2, 3, 4, 5, 6], opens: '18:00', closes: null }] },
      support: [{ field: 'hours', facts: ['F1'] }],
      doubts: ['¿Es bar o boliche?', '  ', '¿Es bar o boliche?', 'd2', 'd3', 'd4', 'd5', 'd6'],
    }
    const place = postProcess(target, data, { sources: [source], seedCategories: ['bar'] })
    const review = reviewExtraction({ ...place, name: 'Bar de prueba' }, data)

    expect(review.unmappedFacts).toEqual([
      { id: 'F3', text: 'Mesa de ping pong', proposedTag: 'ping_pong' },
      { id: 'F4', text: 'Tiene un Lemon con la receta de la abuela', proposedTag: null },
    ])
    expect(review.doubts).toEqual(['¿Es bar o boliche?', 'd2', 'd3', 'd4', 'd5'])
    expect(review.anomalies.map((anomaly) => anomaly.type)).toEqual(['hours_no_close', 'bar_without_drinks', 'no_contact'])
    expect(review.anomalies[0].detail).toBe('dom desde 18:00, lun desde 18:00, mar desde 18:00, mié desde 18:00, jue desde 18:00, vie desde 18:00, sáb desde 18:00')
  })

  it('aplica los proposedTag que existen en tags.ts, también categorías, salvo horarios y dietary', () => {
    const source = { id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://bar.example/', text: 'Chivito vegano. Talleres. Abrimos de noche.' }
    const fact = (id: string, text: string, proposedTag: string | null) => ({ id, text, sourceId: 'S1', kind: 'other' as const, proposedTag })
    const data: PlaceExtraction = {
      ...emptyExtraction,
      facts: [
        fact('F1', 'Tiene chivito vegano', 'chivito'),
        fact('F2', 'Cursos y talleres de barismo', 'events'),
        fact('F3', 'Hacen talleres de cerámica', 'events'),
        fact('F4', 'Abre pasada la medianoche', 'late_night'),
        fact('F5', 'Sirve almuerzos', 'lunch'),
        fact('F6', 'Todo es vegano', 'vegan'),
        fact('F7', 'Es un bar', 'bar'),
        fact('F8', 'Alfajores helados', 'alfajores'),
        fact('F9', 'Tiene wifi', 'wifi'),
      ],
      tags: [{ group: 'features', id: 'wifi', facts: ['F9'] }],
    }
    const place = postProcess(target, data, { sources: [source], seedCategories: ['cafe'] })

    expect(place.tags).toEqual(expect.arrayContaining(['chivito', 'events', 'wifi']))
    expect(place.tags).not.toContain('late_night')
    expect(place.tags).not.toContain('lunch')
    expect(place.categories).toEqual(expect.arrayContaining(['cafe', 'bar']))
    expect(place.dietary.vegan).toBe('unknown')
    // Cada fact que propone el tag queda citado por él; el tag aparece una sola vez.
    expect(place.tags.filter((id) => id === 'events')).toHaveLength(1)
    expect(place.placeFacts.find((item) => item.id === 'F1')?.supports).toEqual(['foods.chivito'])
    expect(place.placeFacts.find((item) => item.id === 'F2')?.supports).toEqual(['features.events'])
    expect(place.placeFacts.find((item) => item.id === 'F3')?.supports).toEqual(['features.events'])
    expect(place.placeFacts.find((item) => item.id === 'F9')?.supports).toEqual(['features.wifi'])
    expect(place.placeFacts.find((item) => item.id === 'F7')?.supports).toEqual(['categories.bar'])
    expect(reviewExtraction(place, data).unmappedFacts.map((item) => [item.id, item.proposedTag])).toEqual([
      ['F4', 'late_night'], ['F5', 'lunch'], ['F6', 'vegan'], ['F8', 'alfajores'],
    ])
  })

  it('suma a un tag que ya existe el fact que lo propone, y ese fact deja de ser unmapped', () => {
    const source = { id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://cafe.example/', text: 'Café de especialidad. Blend Black Magic.' }
    const data: PlaceExtraction = {
      ...emptyExtraction,
      facts: [
        { id: 'F1', text: 'Sirve café de especialidad', sourceId: 'S1', kind: 'drink', proposedTag: null },
        { id: 'F2', text: 'Hay un blend Black Magic y cafés de origen', sourceId: 'S1', kind: 'drink', proposedTag: 'specialty_coffee' },
      ],
      tags: [{ group: 'drinks', id: 'specialty_coffee', facts: ['F1'] }],
    }
    const place = postProcess(target, data, { sources: [source], seedCategories: ['cafe'] })

    expect(place.tags.filter((id) => id === 'specialty_coffee')).toHaveLength(1)
    expect(place.placeFacts.find((item) => item.id === 'F2')?.supports).toEqual(['drinks.specialty_coffee'])
    expect(reviewExtraction(place, data).unmappedFacts).toEqual([])
  })

  it('suma a una categoría que ya está el fact que la propone', () => {
    const source = { id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://parrilla.example/', text: 'Parrilla. Asado a leña.' }
    const data: PlaceExtraction = {
      ...emptyExtraction,
      facts: [
        { id: 'F1', text: 'Es una parrilla', sourceId: 'S1', kind: 'other', proposedTag: null },
        { id: 'F2', text: 'Asan a leña en el salón', sourceId: 'S1', kind: 'food', proposedTag: 'grill' },
      ],
      tags: [{ group: 'categories', id: 'grill', facts: ['F1'] }],
    }
    const place = postProcess(target, data, { sources: [source] })

    expect(place.categories.filter((id) => id === 'grill')).toHaveLength(1)
    expect(place.placeFacts.find((item) => item.id === 'F2')?.supports).toEqual(['categories.grill'])
    expect(reviewExtraction(place, data).unmappedFacts).toEqual([])
  })

  it('marca horario vago, restaurante sin comidas y dietary fully', () => {
    const source = { id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://resto.example/', text: 'Restaurante 100% vegano. instagram.com/resto' }
    const data: PlaceExtraction = {
      ...emptyExtraction,
      facts: [
        { id: 'F1', text: 'Es 100% vegano', sourceId: 'S1', kind: 'dietary', proposedTag: null },
        { id: 'F2', text: 'Instagram @resto', sourceId: 'S1', kind: 'contact', proposedTag: null },
      ],
      dietary: { vegan: 'fully', vegetarian: 'unknown', glutenFree: 'unknown' },
      contact: { instagram: 'resto', website: '' },
      support: [{ field: 'dietary.vegan', facts: ['F1'] }, { field: 'contact.instagram', facts: ['F2'] }],
    }
    const place = postProcess(target, data, { sources: [source], seedCategories: ['restaurant'] })
    const types = reviewExtraction(place, data).anomalies.map((anomaly) => anomaly.type)

    expect(types).toEqual(['hours_vague', 'restaurant_without_food', 'dietary_fully'])
    expect(reviewExtraction(place, data).anomalies[0].detail).toBe('none')
    expect(reviewExtraction(place, data).unmappedFacts).toEqual([])
  })

  it('un restaurante con comidas del día de una fuente real no es "sin comidas", aunque no nombre platos', () => {
    const instagram = { id: 'S1', kind: 'instagram' as const, trust: 'official' as const, url: 'https://www.instagram.com/casa/', text: 'Cocina · Cafetería. Desayunos • Almuerzos • Meriendas' }
    const exa = { id: 'S2', kind: 'exa' as const, trust: 'third_party' as const, url: EXA_SUMMARY_URL, text: 'Desayunos y almuerzos' }
    const meals = (sourceId: string): PlaceExtraction => ({
      ...emptyExtraction,
      facts: [{ id: 'F1', text: 'Desayunos • Almuerzos • Meriendas', sourceId, kind: 'other', proposedTag: null }],
      tags: [
        { group: 'moments', id: 'breakfast', facts: ['F1'] }, { group: 'moments', id: 'lunch', facts: ['F1'] },
        { group: 'moments', id: 'afternoon_snack', facts: ['F1'] },
      ],
    })
    const anomaliesOf = (data: PlaceExtraction) => {
      const place = postProcess(target, data, { sources: [instagram, exa], seedCategories: ['restaurant'] })
      return reviewExtraction(place, data).anomalies.map((anomaly) => anomaly.type)
    }

    expect(anomaliesOf(meals('S1'))).not.toContain('restaurant_without_food')
    // La misma comida sólo del resumen de Exa no alcanza.
    expect(anomaliesOf(meals('S2'))).toContain('restaurant_without_food')
    // Sin comidas del día ni platos sigue entrando.
    expect(anomaliesOf({ ...emptyExtraction, facts: [{ id: 'F1', text: 'Cocina · Cafetería', sourceId: 'S1', kind: 'other', proposedTag: null }] }))
      .toContain('restaurant_without_food')
  })

  it('un bar que una fuente real describe como bar no es "sin bebidas", aunque no nombre bebidas', () => {
    const fact = (sourceId: string): PlaceExtraction => ({
      ...emptyExtraction,
      facts: [{ id: 'F1', text: 'Chivitos al pan y al plato', sourceId, kind: 'food', proposedTag: null }],
      tags: [{ group: 'foods', id: 'chivito', facts: ['F1'] }],
    })
    const reviewOf = (text: string, name = 'Café Brasilero') => {
      const web = { id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://lugar.example/', text }
      const exa = { id: 'S2', kind: 'exa' as const, trust: 'third_party' as const, url: EXA_SUMMARY_URL, text: 'A classic bar. Un bar de chivitos.' }
      const data = fact('S1')
      const place = postProcess({ ...target, name }, data, { sources: [web, exa], seedCategories: ['bar'] })
      return { place, anomalies: reviewExtraction(place, data).anomalies.map((anomaly) => anomaly.type) }
    }

    const bar = reviewOf('Chivitos al pan y al plato.\nEn nuestro bar los clientes se sienten como en casa.')
    expect(bar.anomalies).not.toContain('bar_without_drinks')
    expect(bar.place.tags).toContain('drinks')
    expect(bar.place.tagEvidence).toContainEqual({ tag: 'drinks', mode: 'explicit', signals: ['bar'], factIds: ['C1'] })
    expect(bar.place.placeFacts.find((item) => item.id === 'C1')).toMatchObject({ text: 'En nuestro bar los clientes se sienten como en casa.', supports: ['moments.drinks'] })
    // Error de categoría de Google: una barbería no dice "bar" como palabra, y el resumen de Exa no cuenta.
    expect(reviewOf('Chivitos al pan y al plato.\nBarbería El Sótano: cortes y fade', 'El Sótano').anomalies).toContain('bar_without_drinks')
    // El nombre del lugar solo no lo describe como bar.
    expect(reviewOf('Chivitos al pan y al plato.\nBar Tinkal en PedidosYa', 'Bar Tinkal').anomalies).toContain('bar_without_drinks')
    // Una fuente sin facts del lugar (de otro local) no cuenta.
    const other = { id: 'S3', kind: 'directory' as const, trust: 'third_party' as const, url: 'https://guia.example/otro', text: 'El mejor bar de la zona' }
    const data = fact('S1')
    const place = postProcess(target, data, {
      sources: [{ id: 'S1', kind: 'web', trust: 'official', url: 'https://lugar.example/', text: 'Chivitos al pan y al plato' }, other],
      seedCategories: ['bar'],
    })
    expect(reviewExtraction(place, data).anomalies.map((anomaly) => anomaly.type)).toContain('bar_without_drinks')
  })

  it('lee el modelo y el razonamiento del entorno y arma las opciones de cada proveedor', () => {
    expect(extractionModelConfig({})).toEqual({ model: 'anthropic/claude-sonnet-5.5', reasoning: 'medium' })
    expect(extractionModelConfig({ EXTRACTION_MODEL: 'openai/gpt-5-mini', EXTRACTION_REASONING: 'low' }))
      .toEqual({ model: 'openai/gpt-5-mini', reasoning: 'low' })
    expect(extractionModelConfig({ EXTRACTION_MODEL: 'anthropic/claude-sonnet-5.5', EXTRACTION_REASONING: 'medium' }))
      .toEqual({ model: 'anthropic/claude-sonnet-5.5', reasoning: 'medium' })
    expect(extractionModelConfig({ EXTRACTION_REASONING: 'extremo' }).reasoning).toBe('medium')
    expect(providerOptionsFor({ model: 'openai/gpt-5-mini', reasoning: 'low' })).toEqual({ openai: { reasoningEffort: 'low' } })
    expect(providerOptionsFor({ model: 'anthropic/claude-sonnet-5.5', reasoning: 'medium' })).toEqual({ anthropic: { effort: 'medium', structuredOutputMode: 'outputFormat' } })
    expect(providerOptionsFor({ model: 'otro/modelo', reasoning: 'high' })).toEqual({})
  })

  describe('segunda búsqueda de horarios', () => {
    const sonnet = { model: 'anthropic/claude-sonnet-5.5', reasoning: 'medium' as const }
    const branchPage = { title: 'Sucursales', url: 'https://cadena.example/sucursales', highlights: ['Ituzaingó 1447: todos los días de 12 a 23'], text: 'Ituzaingó 1447: todos los días de 12 a 23. Pocitos: 10 a 22.' }
    type ServiceConfig = ConstructorParameters<typeof PlaceExtractionService>[0]
    const serviceWith = (searchText: NonNullable<ServiceConfig['exa']>['searchText'], generateHours: ServiceConfig['generateHours'], extracted = emptyExtraction) =>
      new PlaceExtractionService({
        apiKey: 'test-key',
        details: { getDetails: async () => googleDetails },
        exa: { configured: true, searchPlace: async () => exaResponse(), searchText },
        generate: async () => extracted,
        generateHours,
        model: sonnet,
        hoursModel: hoursModelConfig({}),
      })

    it('recupera el horario de la sucursal con una búsqueda de highlights y un llamado corto con HOURS_MODEL, y suma su costo', async () => {
      const searchText = vi.fn(async (query: string) => ({ query, results: [branchPage], requestId: 'r' }))
      const hoursCalls: { sources: Source[]; model: string; reasoning: string; address: string }[] = []
      const service = serviceWith(searchText, async (hoursTarget, sources, config) => {
        hoursCalls.push({ sources, model: config.model, reasoning: config.reasoning, address: hoursTarget.address })
        return {
          data: {
            facts: [{ id: 'F9', text: 'La sucursal de Ituzaingó abre todos los días de 12 a 23', sourceId: sources[0].id }],
            raw: 'todos los días de 12 a 23',
            blocks: [{ days: [0, 1, 2, 3, 4, 5, 6], opens: '12:00', closes: '23:00' }],
            otherBranchHours: true,
          },
          inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100, gatewayCostUsd: null,
        }
      })

      const response = await service.extract('place-1', { seedCategories: ['restaurant'] })
      if (response.status !== 'ok') throw new Error('sin fuentes')

      // La otra búsqueda de texto es la dirigida a Instagram, al recolectar fuentes.
      expect(searchText.mock.calls.map(([query]) => query)).toEqual([`${googleDetails.anchor.name} Montevideo instagram`, `${googleDetails.anchor.name} ${googleDetails.anchor.address} horario`])
      // Las fuentes nuevas se numeran después de las del lugar.
      expect(hoursCalls).toHaveLength(1)
      expect(hoursCalls[0].sources.map((source) => source.url)).toEqual(['https://cadena.example/sucursales'])
      expect(hoursCalls[0].sources[0].id).not.toBe('S1')
      expect(hoursCalls[0]).toMatchObject({ model: 'openai/gpt-5-mini', reasoning: 'low' })
      expect(hoursCalls[0].address).toBe(googleDetails.anchor.address)
      expect(response.place.hours).toMatchObject({ status: 'exact', source: 'third_party', missingReason: null })
      expect(response.place.hours.slots).toHaveLength(7)
      // Las reglas que dependen de los horarios se vuelven a aplicar con el horario recuperado.
      expect(response.place.tags).toEqual(expect.arrayContaining(['lunch', 'dinner']))
      expect(response.place.placeFacts[0]).toMatchObject({ id: 'H1', kind: 'hours', supports: ['hours'], sourceUrl: 'https://cadena.example/sucursales' })
      // Exa: 1 búsqueda (0,007) + 1 página de highlights (0,001); gpt-5-mini: 1000 in (0,00025) + 100 out (0,0002).
      expect(response.review.hoursRetry).toEqual({ attempted: true, recovered: true, costUsd: 0.00745 })
      expect(response.performance.costUsd.providers.hoursRetry).toEqual({ model: 'openai/gpt-5-mini', inputTokens: 1000, outputTokens: 100, costUsd: 0.00045 })
      // Búsqueda del lugar + dirigida a Instagram + horario; el mock devuelve una página en las dos de texto.
      expect(response.performance.costUsd.providers.exa).toMatchObject({ requests: 3, highlightPages: 2 })
      expect(response.performance.costUsd.providers.llm.model).toBe(sonnet.model)
    })

    it('marca chain_branch_not_found si sólo hay horarios de otras sucursales, y no_data si no hay nada', async () => {
      const otherBranch = serviceWith(async (query) => ({ query, results: [branchPage], requestId: 'r' }), async () => ({
        facts: [], raw: null, blocks: [], otherBranchHours: true,
      }))
      const chain = await otherBranch.extract('place-1', { seedCategories: ['cafe'] })
      if (chain.status !== 'ok') throw new Error('sin fuentes')
      expect(chain.place.hours).toMatchObject({ status: 'none', missingReason: 'chain_branch_not_found' })
      expect(chain.review.hoursRetry).toMatchObject({ attempted: true, recovered: false })

      const generateHours = vi.fn()
      const empty = serviceWith(async (query) => ({ query, results: [], requestId: 'r' }), generateHours)
      const none = await empty.extract('place-1', { seedCategories: ['cafe'] })
      if (none.status !== 'ok') throw new Error('sin fuentes')
      expect(generateHours).not.toHaveBeenCalled()
      expect(none.place.hours.missingReason).toBe('no_data')
      expect(none.review.hoursRetry).toEqual({ attempted: true, recovered: false, costUsd: 0.007 })
    })

    it('descarta un horario recuperado cuya fuente no nombra la dirección del local', async () => {
      const otherMall = { title: 'Freddo Tres Cruces', url: 'https://shopping.example/freddo', highlights: ['Freddo Tres Cruces: D. a J. de 09:00 a 24:00'] }
      const service = serviceWith(async (query) => ({ query, results: [otherMall], requestId: 'r' }), async (_target, sources) => ({
        facts: [{ id: 'H1', text: 'Abre de 09:00 a 24:00', sourceId: sources[0].id }],
        raw: 'D. a J. de 09:00 a 24:00',
        blocks: [{ days: [0, 1, 2, 3, 4], opens: '09:00', closes: '00:00' }],
        otherBranchHours: false,
      }))
      const response = await service.extract('place-1', { seedCategories: ['cafe'] })
      if (response.status !== 'ok') throw new Error('sin fuentes')
      expect(response.place.hours).toMatchObject({ status: 'none', missingReason: 'no_data' })
      expect(response.review.hoursRetry).toMatchObject({ attempted: true, recovered: false })

      expect(mentionsAddress('Sucursal Gonzalo Ramírez 2051: 12 a 24', 'Av. Gonzalo Ramírez 2051, 11200 Montevideo')).toBe(true)
      expect(mentionsAddress('Freddo Tres Cruces, local 2051B', 'Av. Gonzalo Ramírez 2051, 11200 Montevideo')).toBe(false)
      expect(mentionsAddress('Rambla Rep. de México esquina', 'Rambla República de México, Montevideo')).toBe(false)
      expect(mentionsAddress('Rambla República de México, abre 10 a 20', 'Rambla República de México, Montevideo')).toBe(true)
    })

    it('no busca de nuevo si la extracción ya trae horario', async () => {
      const searchText = vi.fn(async (query: string) => ({ query, results: [], requestId: 'r' }))
      const service = serviceWith(searchText, vi.fn(), { ...extraction, support: [{ field: 'hours', facts: ['F1'] }] })
      const response = await service.extract('place-1', { seedCategories: ['cafe'] })
      if (response.status !== 'ok') throw new Error('sin fuentes')
      // Sólo la búsqueda dirigida a Instagram; ninguna de horario.
      expect(searchText.mock.calls.map(([query]) => query)).toEqual([`${googleDetails.anchor.name} Montevideo instagram`])
      expect(response.place.hours.missingReason).toBeNull()
      expect(response.review.hoursRetry).toEqual({ attempted: false, recovered: false, costUsd: 0 })
      expect(response.performance.costUsd.providers.hoursRetry).toBeUndefined()
    })
  })

  it('lee HOURS_MODEL, marca el prompt de sistema para el cache y cobra la lectura y escritura del cache', () => {
    expect(hoursModelConfig({})).toEqual({ model: 'openai/gpt-5-mini', reasoning: 'low' })
    expect(hoursModelConfig({ HOURS_MODEL: 'anthropic/claude-sonnet-5.5' })).toEqual({ model: 'anthropic/claude-sonnet-5.5', reasoning: 'low' })

    const request = mainExtractionRequest(target, [], { model: 'anthropic/claude-sonnet-5.5', reasoning: 'medium' })
    expect(request.system).toEqual({ role: 'system', content: SYSTEM_PROMPT, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } })
    expect(request.providerOptions).toEqual({ anthropic: { effort: 'medium', structuredOutputMode: 'outputFormat' } })

    // 10.000 de entrada: 2.000 sin cache (2/M), 5.000 leídos (0,1/M) y 3.000 escritos (2,5/M).
    const cost = llmUsageCost('anthropic/claude-sonnet-5.5', { inputTokens: 10_000, cachedInputTokens: 5_000, cacheWriteTokens: 3_000, outputTokens: 0, gatewayCostUsd: null })
    expect(cost.inputCost).toBeCloseTo(0.004 + 0.0005 + 0.0075, 10)
  })

  it('busca las fuentes una vez y las pasa iguales a dos configuraciones de modelo', async () => {
    const getDetails = vi.fn(async () => googleDetails)
    const searchPlace = vi.fn(async () => exaResponse('', [{ title: target.name, url: 'https://cafe.example/', highlights: ['Café de especialidad'] }]))
    const calls: { sources: Source[]; model: string; reasoning: string }[] = []
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails },
      exa: { configured: true, searchPlace },
      generate: async (_target, sources, config) => {
        calls.push({ sources, ...config })
        return { data: emptyExtraction, inputTokens: 1000, cachedInputTokens: 0, outputTokens: 500, gatewayCostUsd: null }
      },
    })

    const collected = await service.collectSources('place-1', { seedCategories: ['cafe'] })
    const mini = await service.extractFrom(collected, { model: 'openai/gpt-5-mini', reasoning: 'low' })
    const sonnet = await service.extractFrom(collected, { model: 'anthropic/claude-sonnet-5.5', reasoning: 'medium' })

    expect(getDetails).toHaveBeenCalledOnce()
    expect(searchPlace).toHaveBeenCalledOnce()
    expect(calls.map((call) => [call.model, call.reasoning])).toEqual([['openai/gpt-5-mini', 'low'], ['anthropic/claude-sonnet-5.5', 'medium']])
    expect(calls[1].sources).toBe(calls[0].sources)
    expect(mini.model).toBe('openai/gpt-5-mini')
    expect(sonnet.performance.costUsd.providers.llm).toMatchObject({ model: 'anthropic/claude-sonnet-5.5', inputCostUsd: 0.002, outputCostUsd: 0.005 })
    expect(mini.performance.costUsd.providers.llm).toMatchObject({ inputCostUsd: 0.00025, outputCostUsd: 0.001 })
  })
})

describe('señales de prominencia', () => {
  it('toma los seguidores del Instagram validado, sin llamadas nuevas', async () => {
    const searchPlace = vi.fn(async () => exaResponse('@cafebrasilero', [
      { title: 'Los 10 mejores cafés de Montevideo', url: 'https://www.elpais.com.uy/gastronomia/cafes', highlights: ['Café Brasilero, desde 1877.'] },
      { title: 'Café Brasilero', url: 'https://www.ladiaria.com.uy/2024/cafe', highlights: ['El Café Brasilero sigue en Ituzaingó.'] },
      { title: 'Café Brasilero - TripAdvisor', url: 'https://www.tripadvisor.com.uy/Restaurant_Review-cafe', highlights: ['Café Brasilero'] },
      { title: 'Café Brasilero', url: 'https://www.pedidosya.com.uy/restaurantes/montevideo/cafe-brasilero', highlights: ['Café Brasilero'] },
    ]))
    const scrapeMany = vi.fn(async () => [{ url: 'https://www.instagram.com/cafebrasilero/', name: target.name, bio: 'Montevideo, Uruguay', links: [], followers: 12_000 }])
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => googleDetails },
      exa: { configured: true, searchPlace },
      instagram: { configured: true, scrapeMany },
      generate: async () => extraction,
    })

    const result = await service.extract('place-1', { seedCategories: ['cafe'] })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.place.signals).toEqual({ igFollowers: 12_000, chainBranch: false })
    expect(searchPlace).toHaveBeenCalledOnce()
    expect(scrapeMany).toHaveBeenCalledOnce()
  })

  it('en una sucursal de cadena guarda los seguidores de la marca y la marca como cadena', () => {
    const source: Source = { id: 'S1', kind: 'web', trust: 'official', url: 'https://marca.example/', text: 'La Nueva Roma. Helados artesanales.' }
    const prominenceSignals = { instagramFollowers: 40_000 }

    const branch = postProcess({ ...target, name: 'La Nueva Roma Cordón' }, emptyExtraction, { sources: [source], prominenceSignals })
    const single = postProcess({ ...target, name: 'La Nueva Roma' }, emptyExtraction, { sources: [source], prominenceSignals })

    expect(branch.signals).toEqual({ igFollowers: 40_000, chainBranch: true })
    expect(single.signals).toEqual({ igFollowers: 40_000, chainBranch: false })
  })

  it('sin señales del pipeline no hay seguidores', () => {
    expect(postProcess(target, emptyExtraction, { sources: [] }).signals).toEqual({ igFollowers: null, chainBranch: false })
  })
})

describe('consultas con el tipo de lugar', () => {
  it('Exa y la búsqueda de Instagram usan la marca con el primaryType de Google', async () => {
    const searchPlace = vi.fn(async () => exaResponse())
    const searchText = vi.fn(async () => ({ query: '', results: [], requestId: 'r' }))
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => ({ ...googleDetails, anchor: { ...googleDetails.anchor, name: 'Musse' }, placeType: 'Restaurante' }) },
      exa: { configured: true, searchPlace, searchText },
      generate: async () => extraction,
    })

    await service.collectSources('place-1', { seedCategories: ['restaurant'] })

    expect(searchPlace).toHaveBeenCalledWith('Musse restaurante Ciudad Vieja')
    expect(searchText).toHaveBeenCalledWith('Musse restaurante Montevideo instagram')
  })
})

describe('logo desde Instagram', () => {
  const profile = { url: 'https://www.instagram.com/cafebrasilero/', name: target.name, bio: 'Montevideo, Uruguay', links: [], profilePicUrl: 'https://cdn.example/brasilero-hd.jpg' }
  const logoImage = () => sharp({ create: { width: 320, height: 320, channels: 3, background: '#ffffff' } })
    .composite([{ input: Buffer.from('<svg width="320" height="320"><circle cx="160" cy="160" r="90" fill="#c0392b"/></svg>') }])
    .png().toBuffer()
  const serviceWith = (overrides: { put?: () => Promise<void>; scrapeMany?: () => Promise<unknown[]> } = {}) => {
    const put = vi.fn(overrides.put ?? (async () => {}))
    const classifyLogo = vi.fn(async () => ({ kind: 'logo' as const, inputTokens: 1_000, outputTokens: 10, gatewayCostUsd: 0.000105 }))
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => googleDetails },
      exa: { configured: true, searchPlace: async () => exaResponse('@cafebrasilero') },
      instagram: { configured: true, scrapeMany: vi.fn(overrides.scrapeMany ?? (async () => [profile])) as never },
      generate: async () => extraction,
      logoStorage: { configured: true, put },
      classifyLogo,
      logoModel: 'anthropic/claude-haiku-5.5',
      logoFetcher: vi.fn(async () => new Response(new Uint8Array(await logoImage()), { status: 200 })) as never,
    })
    return { service, put, classifyLogo }
  }

  it('sube la foto de perfil validada, guarda clasificación y colores, y suma el costo', async () => {
    vi.stubEnv('LOGO_BASE_URL', 'https://logos.example/')
    const { service, put } = serviceWith()

    const result = await service.extract('place-1', { seedCategories: ['cafe'] })

    vi.unstubAllEnvs()
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.place.logo).toMatchObject({ kind: 'logo', bgColor: '#ffffff', color: '#c0392b', source: 'instagram' })
    expect(result.place.logo?.key).toMatch(/^logos\/place-1-[0-9a-f]{8}\.webp$/)
    expect(put).toHaveBeenCalledWith(result.place.logo?.key, expect.any(Buffer))
    expect(result.logoUrl).toBe(`https://logos.example/${result.place.logo?.key}`)
    expect(result.review.logo).toEqual({ status: 'ok', reason: null, kind: 'logo' })
    // 1000 × 0,10 + 10 × 0,50 por millón.
    const { providers, totalUsd } = result.performance.costUsd
    expect(providers.logo).toEqual({ model: 'anthropic/claude-haiku-5.5', inputTokens: 1_000, outputTokens: 10, gatewayCostUsd: 0.000105, costUsd: 0.000105 })
    expect(totalUsd).toBeCloseTo(providers.google.costUsd + providers.exa.costUsd + providers.llm.costUsd + 0.000105, 8)
  })

  it('si la subida falla, el lugar sale igual sin logo y con la falla en review', async () => {
    const { service } = serviceWith({ put: async () => { throw new Error('R2 caído') } })

    const result = await service.extract('place-1', { seedCategories: ['cafe'] })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.place.name).toBeTruthy()
    expect(result.place.logo).toBeNull()
    expect(result.review.logo).toEqual({ status: 'failed', reason: 'upload_failed', kind: 'logo' })
  })

  it('sin Instagram validado no hay logo ni clasificación', async () => {
    const { service, classifyLogo } = serviceWith({ scrapeMany: async () => [] })

    const result = await service.extract('place-1', { seedCategories: ['cafe'] })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.place.logo).toBeNull()
    expect(result.review.logo).toEqual({ status: 'missing', reason: 'no_instagram', kind: null })
    expect(classifyLogo).not.toHaveBeenCalled()
    expect(result.performance.costUsd.providers.logo).toBeUndefined()
  })
})

// Exa con un resultado que nombra la marca y propone los handles del resumen.
const exaNaming = (instagram = '') => async (name: string) => exaResponse(instagram, [{ title: name, url: 'https://guia.example.com/lugar', highlights: [name] }])

describe('validación del Instagram en la primera pasada', () => {
  const branchDetails = { ...googleDetails, anchor: { ...googleDetails.anchor, name: 'Olisa Café Pocitos', address: 'Bvar. España 2501, 11300 Montevideo' } }
  type Profile = { url: string; name: string; bio: string; links: string[]; posts?: string[]; category?: string; latestPostAt?: string; followers?: number; profilePicUrl?: string }
  const handleOf = (profile: Profile) => profile.url.split('/').filter(Boolean).at(-1)
  const detailsFor = (name: string, anchor: Partial<typeof branchDetails.anchor> = {}) => ({ ...branchDetails, anchor: { ...branchDetails.anchor, name, ...anchor } })

  it('el handle es la marca (entera o sin genéricas), sola o + sufijo de ubicación o de rubro, con o sin separador', () => {
    expect(brandHandleMatch('panchova_uy', 'Pancho Va!')).toBe('location')
    expect(brandHandleMatch('olisacafe.uy', 'Olisa Café')).toBe('location')
    expect(brandHandleMatch('olisa_uy', 'Olisa Café')).toBe('location')
    expect(brandHandleMatch('living.uy', 'Living Bar')).toBe('location')
    expect(brandHandleMatch('livingbaruy', 'Living Bar')).toBe('location')
    expect(brandHandleMatch('olisacafeuruguay', 'Olisa Café')).toBe('location')
    expect(brandHandleMatch('brookies.mvd', 'Brookies')).toBe('location')
    expect(brandHandleMatch('marca_montevideo', 'Marca')).toBe('location')
    expect(brandHandleMatch('hakuna_matata_pizzabar', 'Hakuna Matata')).toBe('category')
    expect(brandHandleMatch('cardenalcafe', 'Cardenal')).toBe('category')
    expect(brandHandleMatch('cardenal.resto', 'Cardenal')).toBe('category')
    expect(brandHandleMatch('olisacafe', 'Olisa Café')).toBe('exact')
    expect(brandHandleMatch('otro_uy', 'Olisa Café')).toBeNull()
    expect(brandHandleMatch('uy', 'Casa Bar')).toBeNull()
    // Sin genéricas quedan menos de 3 letras: sólo cuenta la marca entera.
    expect(brandHandleMatch('mo_uy', 'Bar Mo')).toBeNull()
    expect(brandHandleMatch('barmo_uy', 'Bar Mo')).toBe('location')
  })

  describe('handle de la marca', () => {
    const profileFor = (handle: string, bio: string, extra: Partial<Profile> = {}): Profile => ({ url: `https://www.instagram.com/${handle}`, name: 'Otro nombre', bio, links: [], ...extra })
    // El handle sale de las fuentes del lugar (el resumen de Exa) y Apify lo trae.
    const firstPass = async (name: string, profile: Profile, anchor: Partial<typeof branchDetails.anchor> = {}) => {
      const service = new PlaceExtractionService({
        apiKey: 'test-key',
        details: { getDetails: async () => detailsFor(name, anchor) },
        exa: { configured: true, searchPlace: exaNaming(`@${handleOf(profile)}`) },
        instagram: { configured: true, scrapeMany: async () => [profile] },
        generate: async () => extraction,
      })
      return (await service.collectSources('place-1', { seedCategories: [] })).instagramValidation.profile?.url ?? null
    }

    it('alcanza con que el handle sea la marca, sola o con sufijo, salvo otra ciudad en la bio', async () => {
      expect(await firstPass('Cardenal', profileFor('cardenalcafe', 'Café de especialidad'))).toBe('https://www.instagram.com/cardenalcafe/')
      expect(await firstPass('Cardenal Café', profileFor('cardenalcafe', ''))).toBe('https://www.instagram.com/cardenalcafe/')
      expect(await firstPass('Hakuna Matata "Pizza Cubana"', profileFor('hakuna_matata_pizzabar', 'Pizza cubana'))).toBe('https://www.instagram.com/hakuna_matata_pizzabar/')
      expect(await firstPass('Brookies', profileFor('brookies.mvd', 'Cookies'))).toBe('https://www.instagram.com/brookies.mvd/')
      expect(await firstPass('Cardenal', profileFor('cardenalcafe', 'Café de especialidad · Buenos Aires'))).toBeNull()
      expect(await firstPass('Cardenal', profileFor('cardenalcafe', 'Café · Madrid'))).toBeNull()
      expect(await firstPass('Pancho Va!', profileFor('panchova_uy', 'Panchos · Punta del Este'))).toBeNull()
      expect(await firstPass('Cardenal', profileFor('otrocafe', 'Café de especialidad'))).toBeNull()
      // Los posts no cuentan para "otro lugar": sólo la bio.
      expect(await firstPass('Pancho Va!', profileFor('panchova_uy', 'Panchos', { posts: ['Sorteamos un viaje a Madrid'] }))).toBe('https://www.instagram.com/panchova_uy/')
    })

    it('BBC: una cadena que lista sus locales (Punta del Este incluido) y posts de un sorteo a Brasil', async () => {
      const bbc = profileFor('bbc.uy', '📍LAS PIEDRAS \n📍POCITOS \n📍PUNTA DEL ESTE\n📍BZO ORIENTAL\n📍PARQUE RODÓ\n📍SHOPPING COSTA URBANA\n📍CIUDAD DE DURAZNO', {
        name: 'BBC - Burger & Sushi',
        links: ['https://linktr.ee/bbcuy', 'https://bbc.dihola.uy'],
        posts: ['Los esperamos hoy en Pocitos con un 2x1 de cerveza Brader para ir entrando en calor.. porque Brasil te espera🇧🇷🎉🇧🇷🎉'],
      })
      const parqueRodo = { latitude: -34.91, longitude: -56.172 }
      expect(await firstPass('BBC - Burger & Sushi Parque Rodo', bbc, parqueRodo)).toBe('https://www.instagram.com/bbc.uy/')
      // Sin Montevideo ni el barrio del local, una ciudad del interior en la bio rechaza.
      expect(await firstPass('BBC - Burger & Sushi Parque Rodo', { ...bbc, bio: '📍PUNTA DEL ESTE' }, parqueRodo)).toBeNull()
      // Un país extranjero en la bio rechaza siempre.
      expect(await firstPass('BBC - Burger & Sushi Parque Rodo', { ...bbc, bio: `${bbc.bio}\n📍BUENOS AIRES` }, parqueRodo)).toBeNull()
    })

    it('acepta el handle que es la marca + sufijo aunque el nombre no coincida y la bio no diga dónde está', async () => {
      const living = { url: 'https://www.instagram.com/living.uy', name: 'L I V I N G', bio: 'ABIERTO\nJUE - VIE - SÁB', links: [] }
      expect(await firstPass('Living Bar', living)).toBe('https://www.instagram.com/living.uy/')
    })
  })

  describe('desempate entre varios perfiles válidos', () => {
    // Los dos pasan por el sufijo uy: el bar y una mueblería.
    const bar: Profile = { url: 'https://www.instagram.com/living.uy', name: 'L I V I N G', bio: 'ABIERTO\nJUE - VIE - SÁB', links: [], category: 'Bar' }
    const furniture: Profile = { url: 'https://www.instagram.com/living_uy', name: 'Living Uruguay', bio: 'Creamos tu living 🇺🇾', links: [], category: 'Entrepreneur' }
    const run = async (profiles: Profile[], options: { name?: string; logoFetcher?: typeof fetch } = {}) => {
      const service = new PlaceExtractionService({
        apiKey: 'test-key',
        details: { getDetails: async () => detailsFor(options.name ?? 'Living Bar') },
        exa: { configured: true, searchPlace: exaNaming(profiles.map((profile) => `@${handleOf(profile)}`).join(' ')) },
        instagram: { configured: true, scrapeMany: async () => profiles },
        generate: async () => extraction,
        ...(options.logoFetcher ? { logoFetcher: options.logoFetcher } : {}),
      })
      const collected = await service.collectSources('place-1', { seedCategories: [] })
      const result = await service.extractFrom(collected)
      return { collected, review: result.status === 'ok' ? result.review : null }
    }

    it('gana el único con rubro gastronómico, por categoría o por la bio', async () => {
      const byCategory = await run([furniture, bar])
      expect(byCategory.collected.instagramValidation.profile?.url).toBe('https://www.instagram.com/living.uy/')
      expect(byCategory.collected.instagramValidation.candidates).toMatchObject([
        { handle: 'living_uy', decision: 'discarded', reason: 'tie_break_lost' },
        { handle: 'living.uy', decision: 'selected', reason: 'validated_exact_place_profile' },
      ])
      expect(byCategory.review?.instagramTieBreak).toEqual({ rule: 'gastronomy', handles: ['living_uy', 'living.uy'] })

      const byBio = await run([furniture, { ...bar, category: undefined, bio: 'Tragos de autor · JUE a SÁB' }])
      expect(byBio.collected.instagramValidation.profile?.url).toBe('https://www.instagram.com/living.uy/')
      expect(byBio.review?.instagramTieBreak?.rule).toBe('gastronomy')
    })

    it('si sigue el empate no elige ninguno', async () => {
      const { collected, review } = await run([{ ...furniture, category: 'Cocktail bar' }, bar])
      expect(collected.instagramValidation.profile).toBeNull()
      expect(collected.instagramValidation.candidates.map((candidate) => candidate.reason)).toEqual(['multiple_valid_profiles', 'multiple_valid_profiles'])
      expect(review?.instagramTieBreak?.rule).toBe('unresolved')
    })

    it('con el mismo rubro gana el post más reciente; con la misma fecha, el de más seguidores', async () => {
      const old = { ...furniture, category: 'Bar', latestPostAt: '2025-03-01T12:00:00.000Z', followers: 9000 }
      const recent = { ...bar, latestPostAt: '2026-10-10T12:00:00.000Z', followers: 300 }
      const byPost = await run([old, recent])
      expect(byPost.collected.instagramValidation.profile?.url).toBe('https://www.instagram.com/living.uy/')
      expect(byPost.review?.instagramTieBreak).toEqual({ rule: 'latest_post', handles: ['living_uy', 'living.uy'] })

      const byFollowers = await run([{ ...old, latestPostAt: recent.latestPostAt }, recent])
      expect(byFollowers.collected.instagramValidation.profile?.url).toBe('https://www.instagram.com/living_uy/')
      expect(byFollowers.review?.instagramTieBreak?.rule).toBe('followers')
    })

    it('el avatar genérico de Instagram pierde (Cordón Beer: @cordonbeer vs @cordon.beer)', async () => {
      const profiles: Profile[] = [
        { url: 'https://www.instagram.com/cordonbeer', name: 'Cordón Beer', bio: 'Cervecería artesanal · Montevideo', links: [], latestPostAt: '2024-01-10T12:00:00.000Z', followers: 12000 },
        { url: 'https://www.instagram.com/cordon.beer', name: 'Cordón Beer', bio: 'Cervecería artesanal · Montevideo', links: [], latestPostAt: '2026-10-15T12:00:00.000Z', followers: 8000 },
      ]
      const withPictures = (pictures: (string | undefined)[]) => profiles.map((profile, index) => ({ ...profile, ...(pictures[index] ? { profilePicUrl: pictures[index] } : {}) }))
      const genericAvatar = 'https://scontent.cdninstagram.com/v/t51.2885-19/573323465_1219825463302212_7278921664109726296_n.png?x=1'
      const realLogo = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#1d3b48' } })
        .composite([{ input: Buffer.from('<svg width="200" height="200"><circle cx="100" cy="100" r="60" fill="#f2c14e"/></svg>') }]).png().toBuffer()
      const logoFetcher = vi.fn(async () => new Response(new Uint8Array(realLogo), { status: 200 })) as unknown as typeof fetch

      // @cordon.beer tiene el post más reciente pero el avatar genérico: gana @cordonbeer por la foto.
      const byPicture = await run(withPictures(['https://cdn.example/cordonbeer.jpg', genericAvatar]), { name: 'Cordón Beer', logoFetcher })
      expect(byPicture.collected.instagramValidation.profile?.url).toBe('https://www.instagram.com/cordonbeer/')
      expect(byPicture.collected.instagramValidation.candidates).toMatchObject([
        { handle: 'cordonbeer', decision: 'selected', reason: 'validated_exact_place_profile' },
        { handle: 'cordon.beer', decision: 'discarded', reason: 'tie_break_lost' },
      ])
      expect(byPicture.review?.instagramTieBreak).toEqual({ rule: 'profile_picture', handles: ['cordonbeer', 'cordon.beer'] })

      // Los dos con foto real, o uno sin foto que revisar: la foto no decide y sigue el post más reciente.
      for (const pictures of [['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg'], ['https://cdn.example/a.jpg', undefined]]) {
        const { collected, review } = await run(withPictures(pictures), { name: 'Cordón Beer', logoFetcher })
        expect(collected.instagramValidation.profile?.url).toBe('https://www.instagram.com/cordon.beer/')
        expect(review?.instagramTieBreak?.rule).toBe('latest_post')
      }
    })

    it('el avatar genérico detectado sólo por el hash también pierde', async () => {
      const avatar = await sharp(Buffer.from('f5f5f5f5f5f5f5f5f5f5f5dddcf5f5f5f5f5d08888cbf5f5f5f5bb8888b6f5f5f5f5e8a3a1e6f5f5f5f5d5b2b2d6f5f5f5c288888888c2f5ec8a888888888aeb', 'hex'), { raw: { width: 8, height: 8, channels: 1 } })
        .resize(150, 150).jpeg({ quality: 70 }).toBuffer()
      const realLogo = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#7a1f2b' } }).png().toBuffer()
      const logoFetcher = vi.fn(async (url: string | URL | Request) => new Response(new Uint8Array(String(url).includes('avatar') ? avatar : realLogo), { status: 200 })) as unknown as typeof fetch
      const recent = { ...bar, url: 'https://www.instagram.com/living_uy', latestPostAt: '2026-10-10T12:00:00.000Z', profilePicUrl: 'https://cdn.example/avatar.jpg' }
      const older = { ...bar, latestPostAt: '2025-01-01T12:00:00.000Z', profilePicUrl: 'https://cdn.example/logo.jpg' }

      const { collected, review } = await run([recent, older], { logoFetcher })

      expect(collected.instagramValidation.profile?.url).toBe('https://www.instagram.com/living.uy/')
      expect(review?.instagramTieBreak?.rule).toBe('profile_picture')
    })

    it('sin empate no registra regla', async () => {
      const { review } = await run([bar])
      expect(review).not.toHaveProperty('instagramTieBreak')
    })

    it('el rubro sale de la categoría o de palabras del rubro en la bio', () => {
      expect(hasGastronomyCategory({ category: 'Fast food restaurant', bio: '' })).toBe(true)
      expect(hasGastronomyCategory({ category: 'Coffee shop', bio: '' })).toBe(true)
      expect(hasGastronomyCategory({ bio: 'Cervecería artesanal' })).toBe(true)
      expect(hasGastronomyCategory({ category: 'Entrepreneur', bio: 'Creamos tu living' })).toBe(false)
      expect(hasGastronomyCategory({ category: 'Barber shop', bio: 'Barbería' })).toBe(false)
    })
  })

  describe('cuentas personales', () => {
    const photo = () => sharp({ create: { width: 200, height: 200, channels: 3, background: '#a0522d' } }).png().toBuffer()
    const run = async (profiles: Profile[], classifyLogo: LogoClassifier) => {
      const image = await photo()
      const service = new PlaceExtractionService({
        apiKey: 'test-key',
        details: { getDetails: async () => detailsFor('Brujona') },
        exa: { configured: true, searchPlace: exaNaming(profiles.map((profile) => `@${handleOf(profile)}`).join(' ')) },
        instagram: { configured: true, scrapeMany: async () => profiles },
        generate: async () => extraction,
        classifyLogo,
        logoFetcher: vi.fn(async () => new Response(new Uint8Array(image), { status: 200 })) as unknown as typeof fetch,
      })
      return service.collectSources('place-1', { seedCategories: [] })
    }

    it('rechaza una cuenta personal con el nombre de la marca y clasifica cada foto una vez (Brujona)', async () => {
      // Sin bio, sin categoría y con foto de una persona: sólo el handle es la marca.
      const personal = { url: 'https://www.instagram.com/brujona', name: 'jona Bru', bio: '', links: [], profilePicUrl: 'https://cdn.example/brujona.jpg' }
      const real = { url: 'https://www.instagram.com/brujonauy', name: 'Brujona', bio: 'Montevideo', links: [], category: 'Bar', profilePicUrl: 'https://cdn.example/brujonauy.jpg' }
      const classifyLogo = vi.fn(async () => ({ kind: 'person' as const, inputTokens: 600, outputTokens: 5, gatewayCostUsd: 0.0007 }))

      const collected = await run([personal, real], classifyLogo)

      expect(collected.instagramValidation.profile?.url).toBe('https://www.instagram.com/brujonauy/')
      expect(collected.instagramValidation.candidates).toEqual(expect.arrayContaining([
        expect.objectContaining({ handle: 'brujona', decision: 'discarded', reason: 'personal_account', rule: 'personal_account' }),
        expect.objectContaining({ handle: 'brujonauy', decision: 'selected' }),
      ]))
      // Sólo se clasifica @brujona: @brujonauy tiene rubro. El costo entra en el del logo.
      expect(classifyLogo).toHaveBeenCalledTimes(1)
      expect(collected.logo?.classification?.usage).toMatchObject({ inputTokens: 600, gatewayCostUsd: 0.0007 })
    })

    it('con foto de persona y señales de negocio, o sin poder clasificar la foto, el perfil se acepta como antes', async () => {
      const person = vi.fn(async () => ({ kind: 'person' as const }))
      const base = { url: 'https://www.instagram.com/brujona', name: 'Brujona', links: [], profilePicUrl: 'https://cdn.example/brujona.jpg' }
      const url = async (profile: Profile, classifyLogo: LogoClassifier) => (await run([profile], classifyLogo)).instagramValidation.profile?.url
      expect(await url({ ...base, bio: 'Bar de barrio' }, person)).toBe('https://www.instagram.com/brujona/')
      expect(await url({ ...base, bio: '', category: 'Restaurant' }, person)).toBe('https://www.instagram.com/brujona/')
      expect(await url({ ...base, bio: '📍 Bvar. España 2501' }, person)).toBe('https://www.instagram.com/brujona/')
      expect(person).not.toHaveBeenCalled()
      const failing = vi.fn(async () => { throw new Error('gateway') })
      expect(await url({ ...base, bio: '' }, failing)).toBe('https://www.instagram.com/brujona/')
      expect(failing).toHaveBeenCalledTimes(1)
    })
  })
})

describe('procesamiento en dos pasos con revisión del Instagram', () => {
  const official = { url: 'https://www.instagram.com/cafebrasilero', name: 'Café Brasilero', bio: 'Café · Ituzaingó 1447 · Montevideo', links: [], category: 'Cafe', followers: 5000 }
  const corrected = { url: 'https://www.instagram.com/cafe.brasilero.uy', name: 'Café Brasilero', bio: 'Desde 1877', links: [], followers: 1200 }
  const build = (options: { generate?: () => Promise<PlaceExtraction>; manualInstagram?: (id: string) => Promise<{ handle: string | null } | null>; discoveries?: DiscoveryStore } = {}) => {
    const searchPlace = vi.fn(async () => exaResponse('@cafebrasilero', [{ title: 'Café Brasilero', url: 'https://guia.example.com/brasilero', highlights: ['Café Brasilero'] }]))
    const scrapeMany = vi.fn(async (urls: string[]) => [official, corrected].filter((profile) => urls.some((url) => url.includes(profile.url.split('/').at(-1)!))))
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => googleDetails },
      exa: { configured: true, searchPlace },
      instagram: { configured: true, scrapeMany },
      generate: options.generate ?? (async () => extraction),
      manualInstagram: options.manualInstagram,
      discoveries: options.discoveries,
    })
    return { service, searchPlace, scrapeMany }
  }

  it('el paso 1 resume el Instagram y el paso 2 con auto termina igual que en un paso, sin volver a Exa', async () => {
    const { service, searchPlace, scrapeMany } = build()

    const discovery = await service.discoverPlace('place-1', { seedCategories: ['cafe'] })
    expect(discovery).toMatchObject({ googlePlaceId: 'place-1', status: 'approved', handle: 'cafebrasilero', doubt: null })
    expect(discovery.costUsd).toBeGreaterThan(0)

    const result = await service.completePlace('place-1', { mode: 'auto' })
    if (result.status !== 'ok') throw new Error('se esperaba ok')
    expect(searchPlace).toHaveBeenCalledOnce()
    expect(scrapeMany).toHaveBeenCalledOnce()
    expect(result.place.contact.instagram).toBe('cafebrasilero')
    expect(result.review).not.toHaveProperty('instagramManual')
    // El descubrimiento se usa una vez.
    await expect(service.completePlace('place-1', { mode: 'auto' })).rejects.toBeInstanceOf(DiscoveryExpired)
  })

  it('un handle manual se baja solo, sin validar, y el modelo no lo puede rechazar', async () => {
    const rejecting = async () => ({ ...extraction, contact: { ...extraction.contact, instagram: '' }, doubts: ['Instagram rechazado: @cafe.brasilero.uy no es el local'] })
    const { service, searchPlace, scrapeMany } = build({ generate: rejecting })
    await service.discoverPlace('place-1', { seedCategories: ['cafe'] })

    const result = await service.completePlace('place-1', { mode: 'manual', handle: 'cafe.brasilero.uy' })

    if (result.status !== 'ok') throw new Error('se esperaba ok')
    expect(searchPlace).toHaveBeenCalledOnce()
    expect(scrapeMany).toHaveBeenLastCalledWith(['https://www.instagram.com/cafe.brasilero.uy/'])
    expect(result.place.contact.instagram).toBe('cafe.brasilero.uy')
    expect(result.place.signals?.igFollowers).toBe(1200)
    expect(result.review.instagramManual).toEqual({ handle: 'cafe.brasilero.uy' })
    expect(result.sourceAudit.instagramSelection.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ handle: 'cafe.brasilero.uy', decision: 'selected', reason: 'manual', origins: ['manual'] }),
      expect.objectContaining({ handle: 'cafebrasilero', decision: 'discarded', reason: 'manual_override' }),
    ]))
  })

  it('un handle manual que no existe da InstagramNotFound y deja el descubrimiento para corregirlo', async () => {
    const { service, searchPlace } = build()
    await service.discoverPlace('place-1', { seedCategories: ['cafe'] })

    const failure = await service.completePlace('place-1', { mode: 'manual', handle: 'cafe.brasilerro' }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(InstagramNotFound)
    expect((failure as Error).message).toBe('No existe el perfil @cafe.brasilerro en Instagram.')

    const result = await service.completePlace('place-1', { mode: 'manual', handle: 'cafe.brasilero.uy' })
    expect(result.status).toBe('ok')
    expect(searchPlace).toHaveBeenCalledOnce()
  })

  it('"No tiene Instagram" no llama a Apify en el paso 2 y no deja Instagram, seguidores ni logo', async () => {
    const { service, scrapeMany } = build()
    await service.discoverPlace('place-1', { seedCategories: ['cafe'] })

    const result = await service.completePlace('place-1', { mode: 'none' })

    if (result.status !== 'ok') throw new Error('se esperaba ok')
    expect(scrapeMany).toHaveBeenCalledOnce()
    expect(result.place.contact.instagram).toBeNull()
    expect(result.place.signals?.igFollowers).toBeNull()
    expect(result.place.logo).toBeNull()
    expect(result.review.instagramManual).toEqual({ handle: null })
  })

  it('sin descubrimiento guardado (venció o se reinició el server), el paso 2 da DiscoveryExpired', async () => {
    let now = 0
    const discoveries = new DiscoveryStore(DISCOVERY_TTL_MS, () => now)
    const { service } = build({ discoveries })
    await expect(service.completePlace('place-1', { mode: 'auto' })).rejects.toBeInstanceOf(DiscoveryExpired)
    await service.discoverPlace('place-1', { seedCategories: ['cafe'] })
    now = DISCOVERY_TTL_MS + 1
    await expect(service.completePlace('place-1', { mode: 'auto' })).rejects.toBeInstanceOf(DiscoveryExpired)
  })

  it('el Instagram cargado a mano antes (manual_overrides) gana con auto, también en un paso', async () => {
    const saved = build({ manualInstagram: async () => ({ handle: 'cafe.brasilero.uy' }) })
    const discovery = await saved.service.discoverPlace('place-1', { seedCategories: ['cafe'] })
    expect(discovery.saved).toEqual({ handle: 'cafe.brasilero.uy' })
    const oneStep = await saved.service.extract('place-1', { seedCategories: ['cafe'] })
    if (oneStep.status !== 'ok') throw new Error('se esperaba ok')
    expect(oneStep.place.contact.instagram).toBe('cafe.brasilero.uy')
    expect(oneStep.review.instagramManual).toEqual({ handle: 'cafe.brasilero.uy' })

    const none = build({ manualInstagram: async () => ({ handle: null }) })
    const withoutInstagram = await none.service.extract('place-1', { seedCategories: ['cafe'] })
    if (withoutInstagram.status !== 'ok') throw new Error('se esperaba ok')
    expect(withoutInstagram.place.contact.instagram).toBeNull()

    // Si la base falla, sigue con el Instagram del pipeline.
    const broken = build({ manualInstagram: async () => { throw new Error('Neon caído') } })
    const fallback = await broken.service.extract('place-1', { seedCategories: ['cafe'] })
    if (fallback.status !== 'ok') throw new Error('se esperaba ok')
    expect(fallback.place.contact.instagram).toBe('cafebrasilero')
  })

  describe('resumen del paso 1', () => {
    const profile = { url: 'https://www.instagram.com/cafebrasilero/', name: 'Café Brasilero', bio: '', links: [] }
    const summary = (firstPass: Parameters<typeof instagramDiscoverySummary>[0]['firstPass']) =>
      instagramDiscoverySummary({ placeId: 'place-1', details: googleDetails, websiteUrl: null, firstPass }, 0.01)

    it('verde con señales de negocio, amarillo sólo por el nombre', () => {
      expect(summary({ profile: { ...profile, category: 'Cafe' }, candidates: [{ handle: 'cafebrasilero', decision: 'selected', reason: 'validated_exact_place_profile' }] }))
        .toMatchObject({ status: 'approved', handle: 'cafebrasilero', doubt: null })
      expect(summary({ profile, candidates: [{ handle: 'cafebrasilero', decision: 'selected', reason: 'validated_exact_place_profile' }] }))
        .toMatchObject({ status: 'doubtful', handle: 'cafebrasilero', doubt: 'name_only' })
    })

    it('amarillo con empate o con todos rechazados; vacío sin candidatos', () => {
      expect(summary({ profile: null, candidates: [
        { handle: 'otro', decision: 'discarded', reason: 'identity_or_location_mismatch' },
        { handle: 'a', decision: 'discarded', reason: 'multiple_valid_profiles' },
      ] })).toMatchObject({ status: 'doubtful', handle: 'a', doubt: 'tie' })
      expect(summary({ profile: null, candidates: [{ handle: 'otro', decision: 'discarded', reason: 'identity_or_location_mismatch' }] }))
        .toMatchObject({ status: 'doubtful', handle: 'otro', doubt: 'rejected', candidates: [{ handle: 'otro', decision: 'discarded', reason: 'identity_or_location_mismatch' }] })
      expect(summary({ profile: null, candidates: [] })).toMatchObject({ status: 'none', handle: null, doubt: null, costUsd: 0.01 })
    })
  })
})

describe('cuentas agregadoras de Instagram', () => {
  const lanoche = { url: 'https://www.instagram.com/lanocheuy_', name: 'La Noche UY', bio: 'Agenda de la noche · Montevideo', links: [] }
  const named = (name: string) => ({ ...googleDetails, anchor: { ...googleDetails.anchor, name } })
  const build = (options: { registry?: InstagramCandidateRegistry; owners?: InstagramOwners } = {}) => {
    const scrapeMany = vi.fn(async () => [lanoche])
    const names: Record<string, string> = { duna: 'Duna Bar', 'dona-marta': 'Doña Marta', 'cordon-beer-pocitos': 'Cordón Beer Pocitos', 'cordon-beer': 'Cordón Beer' }
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async (placeId: string) => named(names[placeId] ?? 'Duna Bar') },
      exa: { configured: true, searchPlace: async () => exaResponse('@lanocheuy_') },
      instagram: { configured: true, scrapeMany },
      generate: async () => ({ ...extraction, contact: { ...extraction.contact, instagram: '@lanocheuy_' } }),
      candidateRegistry: options.registry,
      instagramOwners: options.owners,
    })
    return { service, scrapeMany }
  }

  it('una cuenta candidata de un lugar de otra marca se descarta sin pedirla a Apify, y no queda como contacto', async () => {
    const { service, scrapeMany } = build()
    await service.collectSources('duna', { seedCategories: [] })
    expect(scrapeMany).toHaveBeenCalledOnce()

    const collected = await service.collectSources('dona-marta', { seedCategories: [] })
    expect(scrapeMany).toHaveBeenCalledOnce()
    expect(collected.instagramValidation).toMatchObject({
      profile: null,
      candidates: [{ handle: 'lanocheuy_', decision: 'discarded', reason: 'shared_with_other_place' }],
    })
    const result = await service.extractFrom(collected)
    if (result.status !== 'ok') throw new Error('se esperaba ok')
    expect(result.place.contact.instagram).toBeNull()
    // Con el otro lugar, para que el lote re-procese a Duna si se había quedado con la cuenta.
    expect(result.review.instagramShared).toEqual([{ handle: 'lanocheuy_', places: ['duna'] }])
  })

  it('un Instagram cargado a mano queda como contacto aunque ya sea candidato de un lugar de otra marca', async () => {
    const { service } = build()
    await service.collectSources('duna', { seedCategories: [] })
    await service.discoverPlace('dona-marta', { seedCategories: [] })

    const result = await service.completePlace('dona-marta', { mode: 'manual', handle: 'lanocheuy_' })

    if (result.status !== 'ok') throw new Error('se esperaba ok')
    expect(result.place.contact.instagram).toBe('lanocheuy_')
    expect(result.review.instagramManual).toEqual({ handle: 'lanocheuy_' })
  })

  it('las sucursales de una misma marca comparten Instagram; re-procesar el mismo lugar tampoco cuenta', async () => {
    const { service, scrapeMany } = build()
    await service.collectSources('cordon-beer', { seedCategories: [] })
    const branch = await service.collectSources('cordon-beer-pocitos', { seedCategories: [] })
    await service.collectSources('cordon-beer', { seedCategories: [] })
    expect(scrapeMany).toHaveBeenCalledTimes(3)
    expect(branch.instagramValidation.candidates).not.toContainEqual(expect.objectContaining({ reason: 'shared_with_other_place' }))
  })

  it('una cuenta guardada en la base para un lugar de otra marca también se descarta; si la base falla, sigue con el registro', async () => {
    const owners = vi.fn(async () => [
      { handle: 'lanocheuy_', googlePlaceId: 'otro-lugar', name: 'Bar Otro' },
      { handle: 'lanocheuy_', googlePlaceId: 'duna-centro', name: 'Duna Bar Centro' },
    ])
    const fromDb = build({ owners })
    const collected = await fromDb.service.collectSources('duna', { seedCategories: [] })
    expect(owners).toHaveBeenCalledWith(['lanocheuy_'], 'duna')
    expect(fromDb.scrapeMany).not.toHaveBeenCalled()
    expect(collected.instagramValidation.candidates).toMatchObject([{ handle: 'lanocheuy_', decision: 'discarded', reason: 'shared_with_other_place' }])
    expect(collected.sharedInstagram).toEqual([{ handle: 'lanocheuy_', places: ['otro-lugar'] }])

    const sameBrand = build({ owners: async () => [{ handle: 'lanocheuy_', googlePlaceId: 'duna-centro', name: 'Duna Bar Centro' }] })
    await sameBrand.service.collectSources('duna', { seedCategories: [] })
    expect(sameBrand.scrapeMany).toHaveBeenCalledOnce()

    const broken = build({ owners: async () => { throw new Error('Neon caído') } })
    const kept = await broken.service.collectSources('duna', { seedCategories: [] })
    expect(broken.scrapeMany).toHaveBeenCalledOnce()
    expect(kept.instagramValidation.candidates).not.toContainEqual(expect.objectContaining({ reason: 'shared_with_other_place' }))
  })

  it('el registro vence a las 12 horas', () => {
    let now = 0
    const registry = new InstagramCandidateRegistry(CANDIDATE_TTL_MS, () => now)
    expect(registry.claim('a', 'Duna Bar', ['LaNocheUy_'])).toEqual(new Map())
    now = 10 * 60 * 60 * 1000
    expect(registry.claim('b', 'Doña Marta', ['lanocheuy_'])).toEqual(new Map([['lanocheuy_', ['a']]]))
    now = CANDIDATE_TTL_MS + 1
    expect(registry.claim('c', 'Jackson Bar', ['lanocheuy_'])).toEqual(new Map([['lanocheuy_', ['b']]]))
  })
})
