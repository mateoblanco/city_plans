import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DISCOUNTS_USER_AGENT, parseRobots, robotsAllows } from './polite-fetch.ts'
import { cleanText, fold } from './text.ts'

/**
 * Geocodificador de direcciones de las fuentes que no traen coordenadas (BROU). Usa el de la IDE Uruguay (direcciones
 * oficiales del padrón: direcciones.ide.uy), no Google. En la prueba con 17 direcciones de Montevideo del PDF de BROU
 * acertó 16 con el número de puerta exacto; Nominatim, 11 (dos quedaron a nivel de calle, a 217 y 520 m).
 */
export type GeocodeQuery = { address: string; city: string; department: string }
export type GeocodeHit = { lat: number; lng: number; matched: string }
export type GeocodeOutcome = { hit: GeocodeHit | null; cached: boolean; reason: string | null }

export type Geocoder = {
  geocode(query: GeocodeQuery): Promise<GeocodeOutcome>
  readonly requests: number
}

export const IDE_UY_BASE = 'https://direcciones.ide.uy'
export const GEOCODE_DELAY_MS = 1_000
/** El número de puerta que devuelve la IDE puede ser el más cercano del padrón ("1189" → "1188"): más lejos, no se usa. */
export const PORTAL_TOLERANCE = 20
const TIMEOUT_MS = 20_000
const RETRY_DELAY_MS = 5_000

/** "EDUARDO RAIZ1905" → "EDUARDO RAIZ 1905". */
export const normalizeAddress = (address: string) => cleanText(address.replace(/([A-Za-zÁÉÍÓÚÑáéíóúñ.])(\d)/g, '$1 $2'))

/**
 * Calle y número de una dirección; null si no es "calle número" (esquinas, "casi", "entre", rutas y km, "SN"): esas no
 * se geocodifican y el cruce va por nombre.
 */
export function streetAndNumber(address: string): { street: string; number: number } | null {
  const text = normalizeAddress(address)
  const match = /^(.+?)\s+(\d{1,5})(?:\s+(?:bis|[a-z]))?$/i.exec(text)
  if (!match) return null
  const street = match[1].trim()
  if (/\b(?:esq|esquina|casi|entre|km|ruta|sn|s\/n)\b\.?/i.test(fold(street))) return null
  return { street, number: Number(match[2]) }
}

const editDistanceAtMostOne = (a: string, b: string) => {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1
      j += 1
      continue
    }
    edits += 1
    if (edits > 1) return false
    if (a.length > b.length) i += 1
    else if (b.length > a.length) j += 1
    else {
      i += 1
      j += 1
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

/**
 * ¿La calle que devolvió la IDE es la que pedimos? Comparte una palabra (o casi: "ROSSELL" y "ROSELL"); el nombre
 * oficial puede tener más ("GARZÓN" → "AVENIDA GENERAL EUGENIO GARZON"). Sin palabra en común (un alias, "YI" →
 * "CARLOS QUIJANO"), sólo vale con el número de puerta exacto.
 */
export function sameStreet(asked: string, official: string): boolean {
  const words = (text: string) => fold(text).replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter((word) => word.length >= 2 && !/^(?:de|del|la|las|los|el|y|e|avenida|av|calle|camino|bulevar|general|gral|doctor|dr|rambla|ingeniero)$/.test(word))
  const officialWords = words(official)
  return words(asked).some((word) => officialWords.some((other) => (word.length >= 4 ? editDistanceAtMostOne(word, other) : word === other)))
}

type Candidate = { type: string; idCalle: number; nomVia: string | null; portalNumber: number; departamento: string; address: string; lat: number; lng: number }

type Options = {
  cacheDir: string
  /** Sin red: sólo lo cacheado (reprocesar una corrida). Lo que no está queda sin coordenadas. */
  offline?: boolean
  baseUrl?: string
  delayMs?: number
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Pedidos de a uno con pausa, user-agent genérico, robots.txt y cache en disco (las direcciones no cambian). */
export function ideUyGeocoder(options: Options): Geocoder {
  const base = options.baseUrl ?? IDE_UY_BASE
  const delayMs = options.delayMs ?? GEOCODE_DELAY_MS
  const doFetch = options.fetch ?? fetch
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? (() => Date.now())
  let requests = 0
  let last = 0
  let robots: Promise<ReturnType<typeof parseRobots>> | null = null
  let queue: Promise<unknown> = Promise.resolve()

  async function once(url: string): Promise<{ status: number; body: unknown }> {
    const wait = last + delayMs - now()
    if (last > 0 && wait > 0) await sleep(wait)
    requests += 1
    try {
      const response = await doFetch(url, { headers: { 'User-Agent': DISCOUNTS_USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (url.endsWith('/robots.txt')) return { status: response.status, body: response.status >= 400 ? '' : await response.text() }
      return { status: response.status, body: response.ok ? await response.json() : null }
    } finally {
      last = now()
    }
  }

  /** Un reintento (con pausa) si la red falla, se pasa del tiempo o responde 5xx. */
  async function getJson(url: string): Promise<unknown> {
    let result: { status: number; body: unknown } | null = null
    try {
      result = await once(url)
    } catch {
      // red o timeout: un reintento
    }
    if (!result || result.status >= 500) {
      await sleep(RETRY_DELAY_MS)
      result = await once(url)
    }
    if (result.status >= 400 && !url.endsWith('/robots.txt')) throw new Error(`${url} respondió ${result.status}.`)
    return result.body
  }

  async function allowed(path: string) {
    robots ??= (getJson(`${base}/robots.txt`) as Promise<string>).then(parseRobots)
    return robotsAllows(await robots, path)
  }

  async function lookup(query: GeocodeQuery, parts: { street: string; number: number }): Promise<{ hit: GeocodeHit | null; reason: string | null }> {
    const department = fold(query.department)
    const params = new URLSearchParams({ q: `${parts.street} ${parts.number}, ${query.city}`, limit: '5' })
    const path = `/api/v1/geocode/candidates?${params}`
    if (!(await allowed(path))) throw new Error(`robots.txt de ${base} no permite ${path}.`)
    const candidates = (await getJson(`${base}${path}`)) as Candidate[]
    const candidate = (Array.isArray(candidates) ? candidates : []).find((item) => item.type === 'CALLEyPORTAL' && fold(item.departamento ?? '') === department)
    if (!candidate) return { hit: null, reason: 'la IDE no encontró la calle y el número en el departamento' }
    const findPath = `/api/v1/geocode/find?${new URLSearchParams({ type: 'CALLEyPORTAL', idcalle: String(candidate.idCalle), portal: String(candidate.portalNumber), source: 'ide_uy' })}`
    const found = ((await getJson(`${base}${findPath}`)) as Candidate[] | null)?.find?.((item) => item.lat && item.lng) ?? null
    if (!found) return { hit: null, reason: `la IDE no dio coordenadas para ${candidate.address}` }
    const delta = Math.abs(found.portalNumber - parts.number)
    if (!sameStreet(parts.street, found.nomVia ?? found.address) && delta !== 0) return { hit: null, reason: `la IDE devolvió otra calle (${found.address})` }
    if (delta > PORTAL_TOLERANCE) return { hit: null, reason: `la IDE sólo tiene un número lejano (${found.address})` }
    return { hit: { lat: found.lat, lng: found.lng, matched: found.address }, reason: null }
  }

  async function geocode(query: GeocodeQuery): Promise<GeocodeOutcome> {
    const parts = streetAndNumber(query.address)
    if (!parts) return { hit: null, cached: false, reason: 'no es calle y número (esquina, ruta o sin número)' }
    const key = createHash('sha256').update(`ide_uy\n${fold(parts.street)} ${parts.number}\n${fold(query.city)}\n${fold(query.department)}`).digest('hex').slice(0, 32)
    const file = join(options.cacheDir, `${key}.json`)
    try {
      const cached = JSON.parse(await readFile(file, 'utf8')) as { hit: GeocodeHit | null; reason: string | null }
      return { hit: cached.hit, cached: true, reason: cached.reason }
    } catch {
      // sin cache
    }
    if (options.offline) return { hit: null, cached: false, reason: 'no estaba en el cache del geocodificador (reprocesado sin red)' }
    const result = await lookup(query, parts)
    await mkdir(options.cacheDir, { recursive: true })
    await writeFile(file, JSON.stringify({ query, ...result, at: new Date(now()).toISOString() }, null, 2))
    return { ...result, cached: false }
  }

  return {
    geocode(query) {
      const next = queue.then(() => geocode(query))
      queue = next.catch(() => undefined)
      return next
    },
    get requests() {
      return requests
    },
  }
}
