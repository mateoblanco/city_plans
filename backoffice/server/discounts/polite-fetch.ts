import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Genérico, sin datos personales. */
export const DISCOUNTS_USER_AGENT = 'Mozilla/5.0 (compatible; CityPlansBackoffice/1.0)'
export const DISCOUNTS_DELAY_MS = 1_500
const TIMEOUT_MS = 20_000
const RETRY_DELAY_MS = 5_000

/** Baja páginas de un proveedor. `requests` cuenta los pedidos a la red (0 al reprocesar desde el HTML crudo). */
export type PageFetcher = {
  get(url: string): Promise<string>
  /** Un archivo binario (el PDF del listado de BROU), con la misma cola, pausa y robots. */
  getBytes?(url: string): Promise<Uint8Array>
  /**
   * La página ya renderizada en un navegador (Playwright), con la misma cola, pausa y robots: sólo para una fuente que
   * manda la página sin los datos a un pedido normal (Scotiabank, si Akamai la frena). Al reprocesar, devuelve el crudo
   * guardado de esa URL.
   */
  render?(url: string): Promise<string>
  readonly requests: number
}

export class FetchPageError extends Error {
  readonly url: string

  constructor(url: string, message: string) {
    super(message)
    this.name = 'FetchPageError'
    this.url = url
  }
}

// ── robots.txt ──

type RobotsRule = { allow: boolean; pattern: string }

/** Reglas del grupo `User-agent: *` (las únicas que aplican a un user-agent genérico). */
export function parseRobots(text: string): RobotsRule[] {
  const rules: RobotsRule[] = []
  let inGroup = false
  let groupHasRules = false
  // Un BOM al principio (Scotiabank) escondería el primer "User-agent: *".
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line)
    if (!match) continue
    const key = match[1].toLowerCase()
    const value = match[2].trim()
    if (key === 'user-agent') {
      // Un user-agent después de reglas abre un grupo nuevo.
      if (groupHasRules) {
        inGroup = false
        groupHasRules = false
      }
      if (value === '*') inGroup = true
      continue
    }
    if (key === 'allow' || key === 'disallow') {
      groupHasRules = true
      if (inGroup && value) rules.push({ allow: key === 'allow', pattern: value })
    }
  }
  return rules
}

function ruleRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith('$')
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  // Un patrón que no empieza con / (como "*.content.html") vale en cualquier parte de la ruta.
  return new RegExp(`^${pattern.startsWith('/') ? '' : '.*'}${body}${anchored ? '$' : ''}`)
}

/** La regla más larga que coincide gana; con empate, Allow. Sin reglas que coincidan, permitido. */
export function robotsAllows(rules: RobotsRule[], path: string): boolean {
  let best: RobotsRule | null = null
  for (const rule of rules) {
    if (!ruleRegex(rule.pattern).test(path)) continue
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule
  }
  return best?.allow ?? true
}

// ── HTML crudo ──

type RawIndex = Record<string, { file: string; status: number; fetchedAt: string; binary?: boolean; rendered?: boolean }>

const safeName = (url: string) => {
  const { hostname, pathname, search } = new URL(url)
  return `${hostname}${pathname}${search}`.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 180)
}

export const rawDir = (root: string, runId: string, providerId: string) => join(root, 'raw', runId, providerId)

/** Abre la URL en un navegador y devuelve el HTML ya renderizado (status de la navegación). */
export type PageRenderer = (url: string, options: { userAgent: string }) => Promise<{ status: number; html: string }>

type LiveOptions = {
  /** Carpeta del HTML crudo de este proveedor en esta corrida. */
  dir: string
  delayMs?: number
  userAgent?: string
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => Date
  /** Para `render` (Playwright en las corridas reales). Sin él, `render` es un error. */
  renderer?: PageRenderer
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Pedidos de a uno, con una pausa entre cada uno, respetando robots.txt. Cada respuesta queda en `dir` (con
 * index.json: url → archivo) para reprocesar sin volver a bajar.
 */
export function politeFetcher(options: LiveOptions): PageFetcher {
  const delayMs = options.delayMs ?? DISCOUNTS_DELAY_MS
  const userAgent = options.userAgent ?? DISCOUNTS_USER_AGENT
  const doFetch = options.fetch ?? fetch
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? (() => new Date())
  const robots = new Map<string, Promise<RobotsRule[]>>()
  const index: RawIndex = {}
  let requests = 0
  let last = 0
  // Una sola cola: aunque alguien llame en paralelo, sale un pedido a la vez.
  let queue: Promise<unknown> = Promise.resolve()

  type Body = { status: number; body: string; bytes: null } | { status: number; body: null; bytes: Uint8Array }

  async function request(url: string, binary = false): Promise<Body> {
    const wait = last + delayMs - now().getTime()
    if (last > 0 && wait > 0) await sleep(wait)
    requests += 1
    try {
      const response = await doFetch(url, {
        headers: { 'User-Agent': userAgent, Accept: binary ? 'application/pdf,*/*;q=0.5' : 'text/html,text/plain;q=0.9,*/*;q=0.5' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'follow',
      })
      if (binary) return { status: response.status, body: null, bytes: new Uint8Array(await response.arrayBuffer()) }
      return { status: response.status, body: await response.text(), bytes: null }
    } finally {
      last = now().getTime()
    }
  }

  async function requestWithRetry(url: string, binary = false) {
    try {
      const result = await request(url, binary)
      if (result.status < 500) return result
    } catch {
      // red o timeout: un reintento
    }
    await sleep(RETRY_DELAY_MS)
    try {
      return await request(url, binary)
    } catch (error) {
      throw new FetchPageError(url, `No se pudo bajar ${url}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function save(url: string, status: number, body: string | Uint8Array, rendered = false) {
    const binary = typeof body !== 'string'
    // El binario conserva su extensión ("….pdf"); el resto queda como .html, como siempre. El renderizado va aparte y
    // pasa a ser el de esa URL (lo que relee el reproceso).
    const file = binary ? safeName(url).replace(/(\.[A-Za-z0-9]{1,5})?$/, (ext) => ext || '.bin') : `${safeName(url)}${rendered ? '.rendered' : ''}.html`
    await mkdir(options.dir, { recursive: true })
    await writeFile(join(options.dir, file), body)
    index[url] = { file, status, fetchedAt: now().toISOString(), ...(binary ? { binary: true } : {}), ...(rendered ? { rendered: true } : {}) }
    await writeFile(join(options.dir, 'index.json'), JSON.stringify(index, null, 2))
  }

  function rulesFor(origin: string) {
    let rules = robots.get(origin)
    if (!rules) {
      rules = (async () => {
        const url = `${origin}/robots.txt`
        const result = await requestWithRetry(url)
        await save(url, result.status, result.body ?? '')
        // Sin robots.txt (404) no hay restricciones; un 5xx después del reintento, no se baja nada.
        if (result.status >= 500) throw new FetchPageError(url, `robots.txt respondió ${result.status}: no se baja nada.`)
        return result.status >= 400 ? [] : parseRobots(result.body ?? '')
      })()
      robots.set(origin, rules)
    }
    return rules
  }

  async function fetchAllowed(url: string, binary: boolean): Promise<Body> {
    const parsed = new URL(url)
    const rules = await rulesFor(parsed.origin)
    if (!robotsAllows(rules, parsed.pathname + parsed.search)) {
      throw new FetchPageError(url, `robots.txt no permite ${parsed.pathname}.`)
    }
    const result = await requestWithRetry(url, binary)
    await save(url, result.status, result.bytes ?? result.body ?? '')
    if (result.status !== 200) throw new FetchPageError(url, `${url} respondió ${result.status}.`)
    return result
  }

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work)
    queue = next.catch(() => undefined)
    return next
  }

  return {
    get(url) {
      return enqueue(async () => (await fetchAllowed(url, false)).body ?? '')
    },
    getBytes(url) {
      return enqueue(async () => (await fetchAllowed(url, true)).bytes ?? new Uint8Array())
    },
    render(url) {
      return enqueue(async () => {
        const renderer = options.renderer
        if (!renderer) throw new FetchPageError(url, `No hay navegador configurado para leer ${url}.`)
        const parsed = new URL(url)
        if (!robotsAllows(await rulesFor(parsed.origin), parsed.pathname + parsed.search)) throw new FetchPageError(url, `robots.txt no permite ${parsed.pathname}.`)
        const wait = last + delayMs - now().getTime()
        if (last > 0 && wait > 0) await sleep(wait)
        requests += 1
        let result: { status: number; html: string }
        try {
          result = await renderer(url, { userAgent })
        } catch (error) {
          throw new FetchPageError(url, `No se pudo abrir ${url} en el navegador: ${error instanceof Error ? error.message : String(error)}`)
        } finally {
          last = now().getTime()
        }
        await save(url, result.status, result.html, true)
        if (result.status !== 200) throw new FetchPageError(url, `${url} respondió ${result.status} en el navegador.`)
        return result.html
      })
    },
    get requests() {
      return requests
    },
  }
}

/**
 * Lee del HTML crudo de una corrida anterior, sin red. Una URL que no se bajó entonces es un error de esa página. Con
 * varias carpetas, la primera es la del proveedor (tiene que existir) y las demás se miran en orden para las URLs que
 * no tiene: la página de Personal Bank también la lee Itaú, y en una corrida vieja sólo la bajó Itaú Personal Bank.
 */
export async function rawFetcher(dirs: string | string[]): Promise<PageFetcher> {
  const [first, ...rest] = typeof dirs === 'string' ? [dirs] : dirs
  const readIndex = async (dir: string) => JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')) as RawIndex
  let own: RawIndex
  try {
    own = await readIndex(first)
  } catch {
    throw new FetchPageError(first, `No hay HTML crudo en ${first}.`)
  }
  const indexes: { dir: string; index: RawIndex }[] = [{ dir: first, index: own }]
  for (const dir of rest) {
    const index = await readIndex(dir).catch(() => null)
    if (index) indexes.push({ dir, index })
  }
  const entryOf = (url: string) => {
    const found = indexes.find(({ index }) => index[url])
    if (!found) throw new FetchPageError(url, `${url} no está en el HTML crudo de esa corrida.`)
    const entry = found.index[url]
    if (entry.status !== 200) throw new FetchPageError(url, `${url} había respondido ${entry.status}.`)
    return join(found.dir, entry.file)
  }
  return {
    async get(url) {
      return readFile(entryOf(url), 'utf8')
    },
    async getBytes(url) {
      return new Uint8Array(await readFile(entryOf(url)))
    },
    // El crudo de esa URL ya es el renderizado si la corrida tuvo que usar el navegador.
    async render(url) {
      return readFile(entryOf(url), 'utf8')
    },
    requests: 0,
  }
}
