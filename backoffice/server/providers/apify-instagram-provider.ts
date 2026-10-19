import { PlacesProviderError } from './places-provider.ts'
import { RateLimitError, TransientProviderError, retryAfterMs } from './rate-limit.ts'

export type InstagramProfileData = {
  url: string
  name: string
  bio: string
  links: string[]
  posts?: string[]
  /** Seguidores del perfil, si Apify los informa. */
  followers?: number
  /** Foto de perfil en alta resolución (o la común si no hay HD). La URL del CDN vence. */
  profilePicUrl?: string
  /** Rubro de la cuenta de negocio en Instagram ("Bar", "Restaurant"…), si lo tiene. */
  category?: string
  /** Fecha (ISO) del post más nuevo entre los que trae Apify, si informa fechas. */
  latestPostAt?: string
}

type ApifyProfile = {
  url?: unknown
  username?: unknown
  fullName?: unknown
  biography?: unknown
  externalUrl?: unknown
  externalUrls?: unknown
  latestPosts?: unknown
  posts?: unknown
  followersCount?: unknown
  profilePicUrl?: unknown
  profilePicUrlHD?: unknown
  businessCategoryName?: unknown
}

function usernameFromUrl(profileUrl: string): string {
  return new URL(profileUrl).pathname.split('/').filter(Boolean)[0] ?? ''
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Fecha del post más nuevo (ISO), con timestamp en ISO o en segundos; null si ninguno trae fecha. */
function latestPostDate(...lists: unknown[]): string | null {
  const times = lists.flatMap((list) => Array.isArray(list) ? list : []).flatMap((post) => {
    if (!post || typeof post !== 'object') return []
    const value = (post as Record<string, unknown>).timestamp
    const time = typeof value === 'number' ? value * 1000 : typeof value === 'string' ? Date.parse(value) : NaN
    return Number.isFinite(time) ? [time] : []
  })
  return times.length > 0 ? new Date(Math.max(...times)).toISOString() : null
}

function postCaptions(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((post) => {
    if (typeof post === 'string') return [stringValue(post)]
    if (!post || typeof post !== 'object') return []
    const record = post as Record<string, unknown>
    return [stringValue(record.caption), stringValue(record.text), stringValue(record.description)].filter(Boolean)
  })
}

/** Perfil de Apify (scraper de perfiles o búsqueda de usuarios: los dos traen los mismos campos). */
function profileFromApify(profile: ApifyProfile): InstagramProfileData | null {
  if (!profile || typeof profile !== 'object') return null
  const username = stringValue(profile.username)
  const profileUrl = stringValue(profile.url) || (username
    ? `https://www.instagram.com/${username}/`
    : '')
  if (!profileUrl) return null
  const links = [
    stringValue(profile.externalUrl),
    ...(Array.isArray(profile.externalUrls)
      ? profile.externalUrls.map((entry) =>
          entry && typeof entry === 'object'
            ? stringValue((entry as Record<string, unknown>).url)
            : '',
        )
      : []),
  ].filter(Boolean)

  const posts = [...new Set([...postCaptions(profile.latestPosts), ...postCaptions(profile.posts)])]
  const followers = profile.followersCount
  const profilePicUrl = stringValue(profile.profilePicUrlHD) || stringValue(profile.profilePicUrl)
  const category = stringValue(profile.businessCategoryName)
  const latestPostAt = latestPostDate(profile.latestPosts, profile.posts)
  return {
    url: profileUrl,
    name: stringValue(profile.fullName) || username,
    bio: stringValue(profile.biography),
    links: [...new Set(links)],
    ...(posts.length > 0 ? { posts } : {}),
    ...(typeof followers === 'number' && Number.isInteger(followers) && followers >= 0 ? { followers } : {}),
    ...(profilePicUrl ? { profilePicUrl } : {}),
    ...(category && category !== 'None' ? { category } : {}),
    ...(latestPostAt ? { latestPostAt } : {}),
  }
}

/** Resultado de la búsqueda de usuarios: perfiles y resultados cobrados (sin perfiles, Apify cobra 1). */
export type InstagramSearchResult = { profiles: InstagramProfileData[]; chargedResults: number }

export const INSTAGRAM_SEARCH_LIMIT = 5

/**
 * Tiempo máximo de cada corrida en Apify (el actor se corta al llegar). run-sync espera hasta 300 s.
 * Con 60 s el lote de Cordón tuvo muchos timeouts.
 */
export const APIFY_PROFILE_TIMEOUT_SECONDS = 120
export const APIFY_SEARCH_TIMEOUT_SECONDS = 120

/**
 * El actor rechaza (400) una búsqueda con signos: !?.,:;-+=*&%$#@/\~^|<>()[]{}"'` (la coma, además,
 * separa términos). Se cambian por espacios; letras con acento, números y espacios quedan.
 */
export function instagramSearchText(value: string): string {
  return value.replace(/[!?.,:;\-+=*&%$#@/\\~^|<>()[\]{}"'`]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export class ApifyInstagramProvider {
  readonly configured: boolean
  private readonly token: string
  private readonly actorId: string
  private readonly searchActorId: string
  private readonly fetcher: typeof fetch
  private readonly memoryMbytes: number | null

  constructor(
    // memoryMbytes: memoria de cada corrida (potencia de 2, desde 128); sin valor, la del actor (1024 MB).
    config: { token?: string; actorId?: string; searchActorId?: string; memoryMbytes?: number },
    fetcher: typeof fetch = fetch,
  ) {
    this.token = config.token?.trim() ?? ''
    this.actorId = config.actorId?.trim() || 'apify~instagram-profile-scraper'
    this.searchActorId = config.searchActorId?.trim() || 'apify~instagram-search-scraper'
    this.configured = Boolean(this.token)
    this.fetcher = fetcher
    const memory = config.memoryMbytes
    this.memoryMbytes = memory && Number.isInteger(memory) && memory >= 128 && (memory & (memory - 1)) === 0 ? memory : null
  }

  async scrape(profileUrl: string): Promise<InstagramProfileData | null> {
    return (await this.scrapeMany([profileUrl]))[0] ?? null
  }

  async scrapeMany(profileUrls: string[]): Promise<InstagramProfileData[]> {
    const usernames = [...new Set(profileUrls.map(usernameFromUrl).filter(Boolean))]
    if (this.configured && usernames.length === 0) return []
    const items = await this.run(this.actorId, { usernames, includeAboutSection: false }, APIFY_PROFILE_TIMEOUT_SECONDS, 'Apify no pudo consultar el perfil de Instagram.')
    return items.flatMap((item) => profileFromApify(item) ?? [])
  }

  /**
   * Búsqueda de usuarios de Instagram por nombre (hasta `limit` perfiles). Instagram compara contra el
   * usuario y el nombre del perfil, no contra la ciudad: el término es sólo la marca, sin signos.
   */
  async searchProfiles(term: string, limit = INSTAGRAM_SEARCH_LIMIT): Promise<InstagramSearchResult> {
    const search = instagramSearchText(term)
    if (this.configured && !search) return { profiles: [], chargedResults: 0 }
    const items = await this.run(this.searchActorId, { search, searchType: 'user', searchLimit: limit }, APIFY_SEARCH_TIMEOUT_SECONDS, 'Apify no pudo buscar el perfil de Instagram.')
    // Sin resultados, el actor escribe un ítem con `error` (no_items), que también se cobra.
    const profiles = items.flatMap((item) => 'error' in item ? [] : profileFromApify(item) ?? []).slice(0, limit)
    return { profiles, chargedResults: items.length }
  }

  private async run(actorId: string, input: Record<string, unknown>, timeoutSeconds: number, failure: string): Promise<(ApifyProfile & { error?: unknown })[]> {
    if (!this.configured) {
      throw new PlacesProviderError(
        'configuration',
        'Falta configurar APIFY_API_TOKEN en .env.local.',
      )
    }
    const endpoint = new URL(
      `https://api.apify.com/v2/actors/${encodeURIComponent(actorId)}/run-sync-get-dataset-items`,
    )
    endpoint.searchParams.set('clean', 'true')
    endpoint.searchParams.set('format', 'json')
    endpoint.searchParams.set('timeout', String(timeoutSeconds))
    if (this.memoryMbytes) endpoint.searchParams.set('memory', String(this.memoryMbytes))

    let response: Response
    try {
      response = await this.fetcher(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout((timeoutSeconds + 5) * 1000),
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new TransientProviderError('timeout', 'Instagram demoró demasiado en responder.')
      }
      throw new TransientProviderError(
        'upstream',
        'No se pudo conectar con Apify para consultar Instagram.',
        { cause: error },
      )
    }

    if (response.status === 401 || response.status === 403) {
      throw new PlacesProviderError('authorization', 'Apify rechazó el token configurado.')
    }
    // 429 es un límite temporal y se reintenta; 402 es falta de crédito y no.
    if (response.status === 429) {
      throw new RateLimitError('apify', 'Apify limitó temporalmente las consultas.', { retryAfterMs: retryAfterMs(response.headers.get('retry-after')) })
    }
    if (response.status === 402) {
      throw new PlacesProviderError('quota', 'Apify no tiene crédito disponible.')
    }
    // Timeout y errores del lado de Apify son pasajeros: se reintentan.
    if (response.status === 408 || response.status === 504) {
      throw new TransientProviderError('timeout', 'Instagram demoró demasiado en responder.')
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as
        | { error?: { message?: unknown } }
        | null
      const detail = typeof payload?.error?.message === 'string'
        ? ` ${payload.error.message}`
        : ''
      if (response.status >= 500) throw new TransientProviderError('upstream', `${failure}${detail}`)
      throw new PlacesProviderError('upstream', `${failure}${detail}`)
    }

    const items = (await response.json()) as unknown
    return Array.isArray(items) ? items.filter((item) => item && typeof item === 'object') : []
  }
}
