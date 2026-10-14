import { PlacesProviderError } from './places-provider.ts'

export type InstagramProfileData = {
  url: string
  name: string
  bio: string
  links: string[]
  posts?: string[]
  /** Seguidores del perfil, si Apify los informa. */
  followers?: number
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
}

function usernameFromUrl(profileUrl: string): string {
  return new URL(profileUrl).pathname.split('/').filter(Boolean)[0] ?? ''
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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

export class ApifyInstagramProvider {
  readonly configured: boolean
  private readonly token: string
  private readonly actorId: string
  private readonly fetcher: typeof fetch

  constructor(
    config: { token?: string; actorId?: string },
    fetcher: typeof fetch = fetch,
  ) {
    this.token = config.token?.trim() ?? ''
    this.actorId = config.actorId?.trim() || 'apify~instagram-profile-scraper'
    this.configured = Boolean(this.token)
    this.fetcher = fetcher
  }

  async scrape(profileUrl: string): Promise<InstagramProfileData | null> {
    return (await this.scrapeMany([profileUrl]))[0] ?? null
  }

  async scrapeMany(profileUrls: string[]): Promise<InstagramProfileData[]> {
    if (!this.configured) {
      throw new PlacesProviderError(
        'configuration',
        'Falta configurar APIFY_API_TOKEN en .env.local.',
      )
    }

    const usernames = [...new Set(profileUrls.map(usernameFromUrl).filter(Boolean))]
    if (usernames.length === 0) return []
    const endpoint = new URL(
      `https://api.apify.com/v2/actors/${encodeURIComponent(this.actorId)}/run-sync-get-dataset-items`,
    )
    endpoint.searchParams.set('clean', 'true')
    endpoint.searchParams.set('format', 'json')
    endpoint.searchParams.set('timeout', '60')

    let response: Response
    try {
      response = await this.fetcher(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ usernames, includeAboutSection: false }),
        signal: AbortSignal.timeout(65_000),
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new PlacesProviderError('timeout', 'Instagram demoró demasiado en responder.')
      }
      throw new PlacesProviderError(
        'upstream',
        'No se pudo conectar con Apify para consultar Instagram.',
        { cause: error },
      )
    }

    if (response.status === 401 || response.status === 403) {
      throw new PlacesProviderError('authorization', 'Apify rechazó el token configurado.')
    }
    if (response.status === 402 || response.status === 429) {
      throw new PlacesProviderError('quota', 'Apify no tiene crédito disponible o limitó la consulta.')
    }
    if (response.status === 408 || response.status === 504) {
      throw new PlacesProviderError('timeout', 'Instagram demoró demasiado en responder.')
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as
        | { error?: { message?: unknown } }
        | null
      const detail = typeof payload?.error?.message === 'string'
        ? ` ${payload.error.message}`
        : ''
      throw new PlacesProviderError(
        'upstream',
        `Apify no pudo consultar el perfil de Instagram.${detail}`,
      )
    }

    const profiles = (await response.json()) as ApifyProfile[]
    return profiles.flatMap((profile) => {
      if (!profile || typeof profile !== 'object') return []
      const username = stringValue(profile.username)
      const profileUrl = stringValue(profile.url) || (username
        ? `https://www.instagram.com/${username}/`
        : '')
      if (!profileUrl) return []
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
      return [{
        url: profileUrl,
        name: stringValue(profile.fullName) || username,
        bio: stringValue(profile.biography),
        links: [...new Set(links)],
        ...(posts.length > 0 ? { posts } : {}),
        ...(typeof followers === 'number' && Number.isInteger(followers) && followers >= 0 ? { followers } : {}),
      }]
    })
  }
}
