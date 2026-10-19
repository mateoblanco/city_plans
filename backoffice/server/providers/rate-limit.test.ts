import { APICallError } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlacesProviderError } from './places-provider.ts'
import { isRateLimited, RateLimitError, RateLimitLog, retryAfterMs, TransientProviderError, withRateLimitRetry } from './rate-limit.ts'

const gateway429 = (headers: Record<string, string> = {}) => new APICallError({
  message: 'Too Many Requests', url: 'https://ai-gateway.example/v1', requestBodyValues: {}, statusCode: 429, responseHeaders: headers,
})

function retrying<T>(operation: () => Promise<T>, log = new RateLimitLog('place-1')) {
  const waits: number[] = []
  const sleep = vi.fn(async (ms: number) => { waits.push(ms) })
  // random 1: la espera es el backoff completo, así el test es determinista.
  const run = withRateLimitRetry('llm', operation, log, { sleep, random: () => 1 })
  return { run, waits, log, sleep }
}

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { vi.restoreAllMocks() })

describe('withRateLimitRetry', () => {
  it('ante un 429 reintenta con esperas crecientes y devuelve el valor', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(gateway429())
      .mockRejectedValueOnce(gateway429())
      .mockResolvedValueOnce('ok')
    const { run, waits, log } = retrying(operation)

    await expect(run).resolves.toBe('ok')
    expect(operation).toHaveBeenCalledTimes(3)
    expect(waits).toEqual([1000, 2000])
    expect(log.summary()).toEqual([{ service: 'llm', retries: 2, waitedMs: 3000, recovered: true }])
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"event":"place_extraction_rate_limited"'))
  })

  it('el jitter deja la espera entre la mitad y el total del backoff', async () => {
    const waits: number[] = []
    const operation = vi.fn().mockRejectedValueOnce(gateway429()).mockResolvedValueOnce('ok')
    await withRateLimitRetry('exa', operation, null, { sleep: async (ms) => { waits.push(ms) }, random: () => 0 })
    expect(waits).toEqual([500])
  })

  it('respeta Retry-After, con tope', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new RateLimitError('apify', 'Apify limitó', { retryAfterMs: 7000 }))
      .mockRejectedValueOnce(gateway429({ 'retry-after': '3' }))
      .mockRejectedValueOnce(gateway429({ 'retry-after': '600' }))
      .mockResolvedValueOnce('ok')
    const { run, waits } = retrying(operation)

    await expect(run).resolves.toBe('ok')
    expect(waits).toEqual([7000, 3000, 20_000])
  })

  it('no reintenta lo que no es un 429: sin crédito (402), 500 ni validación', async () => {
    for (const error of [
      new PlacesProviderError('quota', 'Apify no tiene crédito disponible.'),
      new APICallError({ message: 'boom', url: 'https://x', requestBodyValues: {}, statusCode: 500 }),
      new PlacesProviderError('validation', 'inválido'),
    ]) {
      const operation = vi.fn().mockRejectedValue(error)
      const { run, sleep, log } = retrying(operation)
      await expect(run).rejects.toBe(error)
      expect(operation).toHaveBeenCalledOnce()
      expect(sleep).not.toHaveBeenCalled()
      expect(log.summary()).toEqual([])
    }
  })

  it('agotados los 4 intentos relanza como quota, con el motivo registrado', async () => {
    const operation = vi.fn().mockRejectedValue(gateway429())
    const { run, waits, log } = retrying(operation)

    await expect(run).rejects.toMatchObject({ kind: 'quota', message: 'Vercel AI Gateway limitó las consultas (4 intentos).' })
    expect(operation).toHaveBeenCalledTimes(4)
    expect(waits).toEqual([1000, 2000, 4000])
    expect(log.summary()).toEqual([{ service: 'llm', retries: 3, waitedMs: 7000, recovered: false }])
  })

  it('un error propio de 429 agotado se relanza tal cual', async () => {
    const error = new RateLimitError('exa', 'Exa limitó temporalmente las consultas.')
    const log = new RateLimitLog('place-1')
    await expect(withRateLimitRetry('exa', vi.fn().mockRejectedValue(error), log, { sleep: async () => {}, attempts: 2 })).rejects.toBe(error)
    expect(log.summary()).toEqual([{ service: 'exa', retries: 1, waitedMs: expect.any(Number), recovered: false }])
  })
})

describe('fallas pasajeras', () => {
  const timeout = () => new TransientProviderError('timeout', 'Instagram demoró demasiado en responder.')

  it('reintenta con las esperas dadas (más jitter) y registra los reintentos aparte de los 429', async () => {
    const operation = vi.fn().mockRejectedValueOnce(timeout()).mockRejectedValueOnce(new RateLimitError('apify', '429')).mockResolvedValueOnce('ok')
    const waits: number[] = []
    const log = new RateLimitLog('place-1')
    const value = await withRateLimitRetry('apify', operation, log, { sleep: async (ms) => { waits.push(ms) }, random: () => 0, transientDelaysMs: [5000, 15000] })
    expect(value).toBe('ok')
    expect(waits).toEqual([5000, 500])
    expect(log.summary()).toEqual([{ service: 'apify', retries: 1, transientRetries: 1, waitedMs: 5500, recovered: true }])
  })

  it('agotadas las esperas relanza el error y lo registra sin recuperar', async () => {
    const operation = vi.fn(async () => { throw timeout() })
    const log = new RateLimitLog('place-1')
    await expect(withRateLimitRetry('apify', operation, log, { sleep: async () => {}, random: () => 1, transientDelaysMs: [5000, 15000] })).rejects.toBeInstanceOf(TransientProviderError)
    expect(operation).toHaveBeenCalledTimes(3)
    expect(log.summary()).toEqual([{ service: 'apify', retries: 0, transientRetries: 2, waitedMs: 7500 + 22500, recovered: false }])
  })

  it('sin esperas configuradas (Exa, el LLM) no reintenta una falla pasajera', async () => {
    const operation = vi.fn(async () => { throw timeout() })
    await expect(withRateLimitRetry('exa', operation, null, { sleep: async () => {} })).rejects.toBeInstanceOf(TransientProviderError)
    expect(operation).toHaveBeenCalledOnce()
  })
})

describe('429', () => {
  it('reconoce el error propio, el del AI SDK y cualquiera con statusCode 429', () => {
    expect(isRateLimited(new RateLimitError('exa', 'x'))).toBe(true)
    expect(isRateLimited(gateway429())).toBe(true)
    expect(isRateLimited({ statusCode: 429 })).toBe(true)
    expect(isRateLimited({ statusCode: 402 })).toBe(false)
    expect(isRateLimited(new Error('429'))).toBe(false)
  })

  it('lee Retry-After en segundos o como fecha', () => {
    expect(retryAfterMs('2')).toBe(2000)
    expect(retryAfterMs('Fri, 16 Oct 2026 12:00:05 GMT', Date.parse('2026-10-16T12:00:00Z'))).toBe(5000)
    expect(retryAfterMs('')).toBeNull()
    expect(retryAfterMs('pronto')).toBeNull()
  })
})
