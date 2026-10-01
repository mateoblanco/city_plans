import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { chromium, type Browser } from 'playwright'
import { PlacesProviderError } from './places-provider.ts'

const MAX_CONTENT_LENGTH = 25_000
const NAVIGATION_TIMEOUT_MS = 15_000

export type WebsitePageData = {
  url: string
  title: string
  description: string
  content: string
  instagramUrls: string[]
  links?: string[]
}

export type RawWebsitePageData = {
  title: string
  description: string
  content: string
  links: string[]
  structured: unknown[]
}

type DnsLookup = (hostname: string) => Promise<readonly { address: string }[]>

const defaultLookup: DnsLookup = (hostname) =>
  lookup(hostname, { all: true, verbatim: true })

function blockedIpv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true
  const [a, b, c] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  )
}

export function isBlockedIp(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '')
  const version = isIP(normalized)
  if (version === 4) return blockedIpv4(normalized)
  if (version !== 6) return true

  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  if (mappedIpv4) return blockedIpv4(mappedIpv4)
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('2001:db8:')
  )
}

export async function assertPublicHttpUrl(
  value: string,
  resolver: DnsLookup = defaultLookup,
): Promise<URL> {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new PlacesProviderError('upstream', 'La web del local no tiene una URL válida.')
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new PlacesProviderError('upstream', 'La web del local usa una URL no permitida.')
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new PlacesProviderError('upstream', 'La web del local apunta a una red privada.')
  }

  const addresses = isIP(hostname) ? [{ address: hostname }] : await resolver(hostname)
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedIp(address))) {
    throw new PlacesProviderError('upstream', 'La web del local apunta a una red privada.')
  }
  return url
}

export function normalizeInstagramProfileUrl(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
  if (hostname !== 'instagram.com' && hostname !== 'instagr.am') return null

  const segments = url.pathname.split('/').filter(Boolean)
  const blockedRoots = new Set([
    'accounts',
    'direct',
    'explore',
    'p',
    'reel',
    'reels',
    'stories',
    'share',
  ])
  if (segments.length !== 1 || blockedRoots.has(segments[0].toLowerCase())) return null
  if (!/^[A-Za-z0-9._]{1,30}$/.test(segments[0])) return null
  return `https://www.instagram.com/${segments[0]}/`
}

function cleanText(value: string, maxLength = MAX_CONTENT_LENGTH): string {
  const seen = new Set<string>()
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => {
      if (!line || seen.has(line)) return false
      seen.add(line)
      return true
    })
  return lines.join('\n').slice(0, maxLength).trim()
}

export function normalizeWebsitePageData(
  url: string,
  extracted: RawWebsitePageData,
): WebsitePageData {
  const visibleContent = cleanText(extracted.content)
  const structuredContent = cleanText(
    extracted.structured.map((value) => JSON.stringify(value)).join('\n'),
    8_000,
  )
  const content = cleanText(
    [visibleContent, structuredContent].filter(Boolean).join('\n'),
  )
  const instagramUrls = [...new Set(
    extracted.links.flatMap((link) => {
      const normalized = normalizeInstagramProfileUrl(link)
      return normalized ? [normalized] : []
    }),
  )]

  return {
    url,
    title: cleanText(extracted.title, 500),
    description: cleanText(extracted.description, 2_000),
    content,
    instagramUrls,
    links: [...new Set(extracted.links.filter((link) => /^https?:\/\//i.test(link)))],
  }
}

export class PlaywrightWebsiteScraper {
  readonly configured = true
  private browserPromise?: Promise<Browser>
  private readonly resolver: DnsLookup

  constructor(resolver: DnsLookup = defaultLookup) {
    this.resolver = resolver
  }

  private getBrowser(): Promise<Browser> {
    this.browserPromise ??= chromium.launch({ headless: true }).catch((error) => {
      this.browserPromise = undefined
      throw new PlacesProviderError(
        'configuration',
        'No se pudo iniciar Chromium. Ejecutá npx playwright install chromium.',
        { cause: error },
      )
    })
    return this.browserPromise
  }

  async validateUrl(value: string): Promise<string> {
    return (await assertPublicHttpUrl(value, this.resolver)).href
  }

  async scrape(value: string): Promise<WebsitePageData> {
    const initialUrl = new URL(await this.validateUrl(value))
    const browser = await this.getBrowser()
    const context = await browser.newContext({
      userAgent: 'CityPlansBackoffice/1.0 (website enrichment)',
    })

    try {
      const checkedHosts = new Map<string, boolean>()
      await context.route('**/*', async (route) => {
        const requestUrl = route.request().url()
        let parsed: URL
        try {
          parsed = new URL(requestUrl)
        } catch {
          await route.abort('blockedbyclient')
          return
        }
        if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') {
          await route.continue()
          return
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          await route.abort('blockedbyclient')
          return
        }

        const cacheKey = parsed.hostname.toLowerCase()
        let allowed = checkedHosts.get(cacheKey)
        if (allowed === undefined) {
          allowed = await assertPublicHttpUrl(parsed.href, this.resolver)
            .then(() => true)
            .catch(() => false)
          checkedHosts.set(cacheKey, allowed)
        }
        if (allowed) await route.continue()
        else await route.abort('blockedbyclient')
      })

      const page = await context.newPage()
      const response = await page.goto(initialUrl.href, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS,
      })
      if (!response || response.status() >= 400) {
        throw new PlacesProviderError('upstream', 'La web del local no respondió correctamente.')
      }
      await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => undefined)

      const finalUrl = await assertPublicHttpUrl(page.url(), this.resolver)
      const extracted = await page.evaluate(() => {
        const main = document.querySelector('main, article') as HTMLElement | null
        const root = main ?? document.body
        const structured = [...document.querySelectorAll('script[type="application/ld+json"]')]
          .flatMap((script) => {
            try {
              const parsed = JSON.parse(script.textContent ?? '') as unknown
              const values = Array.isArray(parsed) ? parsed : [parsed]
              return values.filter((item) => {
                if (!item || typeof item !== 'object') return false
                const type = (item as Record<string, unknown>)['@type']
                const types = Array.isArray(type) ? type : [type]
                return types.some((entry) =>
                  typeof entry === 'string' &&
                  /(Restaurant|FoodEstablishment|LocalBusiness|Cafe|Bar)/i.test(entry),
                )
              })
            } catch {
              return []
            }
          })

        root?.querySelectorAll(
          'script, style, noscript, svg, nav, header, footer, dialog, [aria-hidden="true"], [class*="cookie" i], [id*="cookie" i]',
        ).forEach((element) => element.remove())

        return {
          title: document.title,
          description:
            document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
          content: root?.innerText ?? '',
          links: [...document.querySelectorAll('a[href]')].map((anchor) =>
            (anchor as HTMLAnchorElement).href,
          ),
          structured,
        }
      })

      return normalizeWebsitePageData(finalUrl.href, extracted)
    } catch (error) {
      if (error instanceof PlacesProviderError) throw error
      if (error instanceof Error && /Timeout/i.test(error.name + error.message)) {
        throw new PlacesProviderError('timeout', 'La web del local demoró demasiado en responder.')
      }
      throw new PlacesProviderError(
        'upstream',
        'No se pudo extraer información de la web del local.',
        { cause: error },
      )
    } finally {
      await context.close()
    }
  }
}
