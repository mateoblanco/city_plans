import { APICallError } from 'ai'
import { PlacesProviderError } from './places-provider.ts'
import type { LimitedService } from './service-limits.ts'

const SERVICE_NAMES: Record<LimitedService, string> = { apify: 'Apify', exa: 'Exa', llm: 'Vercel AI Gateway' }

/** 429 de un proveedor. Sigue siendo `quota` (HTTP 429 hacia el frontend), pero se puede reintentar. */
export class RateLimitError extends PlacesProviderError {
  readonly service: LimitedService
  readonly retryAfterMs: number | null

  constructor(service: LimitedService, message: string, options: ErrorOptions & { retryAfterMs?: number | null } = {}) {
    super('quota', message, options)
    this.name = 'RateLimitError'
    this.service = service
    this.retryAfterMs = options.retryAfterMs ?? null
  }
}

/**
 * Falla pasajera de un proveedor (timeout, 5xx, error de red): se puede reintentar. Los rechazos (400, 401,
 * 402, 403) no son transitorios.
 */
export class TransientProviderError extends PlacesProviderError {
  constructor(kind: 'timeout' | 'upstream', message: string, options?: ErrorOptions) {
    super(kind, message, options)
    this.name = 'TransientProviderError'
  }
}

/** Retry-After en segundos o como fecha HTTP; null si no viene o no se entiende. */
export function retryAfterMs(value: string | null | undefined, now = Date.now()): number | null {
  if (!value?.trim()) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return seconds >= 0 ? Math.round(seconds * 1000) : null
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - now) : null
}

/** Un 429: el error propio, el del AI SDK o cualquiera con statusCode 429 (el de Exa, por ejemplo). */
export function isRateLimited(error: unknown): boolean {
  if (error instanceof RateLimitError) return true
  if (APICallError.isInstance(error)) return error.statusCode === 429
  return typeof error === 'object' && error !== null && 'statusCode' in error && Number(error.statusCode) === 429
}

function waitHint(error: unknown): number | null {
  if (error instanceof RateLimitError) return error.retryAfterMs
  if (APICallError.isInstance(error)) return retryAfterMs(error.responseHeaders?.['retry-after'])
  return null
}

/** retries: reintentos por 429; transientRetries: por timeout o error pasajero (falta si no hubo). */
export type RateLimitEntry = { service: LimitedService; retries: number; waitedMs: number; recovered: boolean; transientRetries?: number }

/** Junta los reintentos de un lugar (429 y fallas pasajeras): una entrada por servicio, para review.rateLimits. */
export class RateLimitLog {
  private readonly entries = new Map<LimitedService, RateLimitEntry>()
  readonly placeId: string

  constructor(placeId: string) {
    this.placeId = placeId
  }

  retried(service: LimitedService, waitMs: number) {
    const entry = this.entries.get(service) ?? { service, retries: 0, waitedMs: 0, recovered: true }
    entry.retries += 1
    entry.waitedMs += waitMs
    this.entries.set(service, entry)
  }

  retriedTransient(service: LimitedService, waitMs: number) {
    const entry = this.entries.get(service) ?? { service, retries: 0, waitedMs: 0, recovered: true }
    entry.transientRetries = (entry.transientRetries ?? 0) + 1
    entry.waitedMs += waitMs
    this.entries.set(service, entry)
  }

  gaveUp(service: LimitedService) {
    const entry = this.entries.get(service) ?? { service, retries: 0, waitedMs: 0, recovered: false }
    entry.recovered = false
    this.entries.set(service, entry)
  }

  summary(): RateLimitEntry[] {
    return [...this.entries.values()].map((entry) => ({ ...entry }))
  }
}

export type RateLimitRetryOptions = {
  /** Intentos en total, contando el primero. */
  attempts?: number
  baseMs?: number
  maxMs?: number
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  /** Esperas antes de cada reintento ante una falla pasajera; su largo es la cantidad de reintentos (sin, 0). */
  transientDelaysMs?: readonly number[]
}

const DEFAULTS = { attempts: 4, baseMs: 1000, maxMs: 20_000 }

/** Apify: dos reintentos ante timeout o error pasajero, con espera creciente. */
export const APIFY_TRANSIENT_DELAYS_MS = [5_000, 15_000] as const
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Reintenta `operation` ante un 429, con backoff exponencial y jitter (o el Retry-After del
 * proveedor, con tope en maxMs), y ante una falla pasajera con las esperas de transientDelaysMs (más
 * jitter). La espera queda afuera de `operation`: si adentro hay un withServiceLimit, el cupo se libera
 * mientras se espera. Agotados los intentos, relanza el error; en el LLM el mensaje dice cuántos intentos hubo.
 */
export async function withRateLimitRetry<T>(
  service: LimitedService,
  operation: () => Promise<T>,
  log: RateLimitLog | null,
  options: RateLimitRetryOptions = {},
): Promise<T> {
  const { attempts, baseMs, maxMs } = { ...DEFAULTS, ...options }
  const sleep = options.sleep ?? defaultSleep
  const random = options.random ?? Math.random
  const transientDelays = options.transientDelaysMs ?? []
  let transientAttempt = 0
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof TransientProviderError) {
        if (transientAttempt >= transientDelays.length) {
          if (transientDelays.length > 0) log?.gaveUp(service)
          throw error
        }
        const base = transientDelays[transientAttempt]
        transientAttempt += 1
        attempt -= 1
        const waitMs = Math.round(base + random() * (base / 2))
        log?.retriedTransient(service, waitMs)
        console.warn(JSON.stringify({ event: 'place_extraction_transient_retry', service, placeId: log?.placeId ?? null, attempt: transientAttempt, waitMs, error: error.message }))
        await sleep(waitMs)
        continue
      }
      if (!isRateLimited(error)) throw error
      if (attempt >= attempts) {
        log?.gaveUp(service)
        console.warn(JSON.stringify({ event: 'place_extraction_rate_limited', service, placeId: log?.placeId ?? null, attempt, gaveUp: true }))
        throw error instanceof PlacesProviderError
          ? error
          : new RateLimitError(service, `${SERVICE_NAMES[service]} limitó las consultas (${attempts} intentos).`, { cause: error })
      }
      const backoff = Math.min(maxMs, baseMs * 2 ** (attempt - 1))
      const hint = waitHint(error)
      // Jitter "igual": entre la mitad y el total del backoff, para que los lugares no reintenten juntos.
      const waitMs = Math.round(hint !== null ? Math.min(maxMs, hint) : backoff / 2 + random() * (backoff / 2))
      log?.retried(service, waitMs)
      console.warn(JSON.stringify({ event: 'place_extraction_rate_limited', service, placeId: log?.placeId ?? null, attempt, waitMs }))
      await sleep(waitMs)
    }
  }
}
