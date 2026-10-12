import pLimit, { type LimitFunction } from 'p-limit'

export type LimitedService = 'apify' | 'exa' | 'llm'

const DEFAULT_LIMITS: Record<LimitedService, number> = {
  apify: 2,
  exa: 3,
  llm: 3,
}

const ENV_NAMES: Record<LimitedService, string> = {
  apify: 'EXTRACT_LIMIT_APIFY',
  exa: 'EXTRACT_LIMIT_EXA',
  llm: 'EXTRACT_LIMIT_LLM',
}

// Instancias de módulo compartidas por todas las requests. Se crean en el primer uso
// porque los imports ESM se evalúan antes de que server/index.ts cargue el .env.
const limiters = new Map<LimitedService, LimitFunction>()

function configuredConcurrency(service: LimitedService) {
  const value = Number(process.env[ENV_NAMES[service]])
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_LIMITS[service]
}

export function serviceLimit(service: LimitedService): LimitFunction {
  let limiter = limiters.get(service)
  if (!limiter) {
    limiter = pLimit(configuredConcurrency(service))
    limiters.set(service, limiter)
  }
  return limiter
}

export function withServiceLimit<T>(service: LimitedService, operation: () => Promise<T>): Promise<T> {
  return serviceLimit(service)(operation)
}

/** Sólo para tests: descarta las instancias para releer la configuración. */
export function resetServiceLimits() {
  limiters.clear()
}
