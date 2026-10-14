import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetServiceLimits, serviceLimit, withServiceLimit } from './service-limits.ts'

afterEach(() => {
  vi.unstubAllEnvs()
  resetServiceLimits()
})

describe('service limits', () => {
  it('usa 2 para Apify, 3 para Exa y 3 para el LLM por defecto', () => {
    expect(serviceLimit('apify').concurrency).toBe(2)
    expect(serviceLimit('exa').concurrency).toBe(3)
    expect(serviceLimit('llm').concurrency).toBe(3)
  })

  it('lee la concurrencia de las variables de entorno e ignora valores inválidos', () => {
    vi.stubEnv('EXTRACT_LIMIT_APIFY', '1')
    vi.stubEnv('EXTRACT_LIMIT_EXA', '0')
    vi.stubEnv('EXTRACT_LIMIT_LLM', 'muchos')
    expect(serviceLimit('apify').concurrency).toBe(1)
    expect(serviceLimit('exa').concurrency).toBe(3)
    expect(serviceLimit('llm').concurrency).toBe(3)
  })

  it('comparte la misma instancia entre llamadas y nunca supera el límite', async () => {
    expect(serviceLimit('llm')).toBe(serviceLimit('llm'))
    let active = 0
    let max = 0
    const task = () => withServiceLimit('apify', async () => {
      active += 1
      max = Math.max(max, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
    })
    await Promise.all(Array.from({ length: 6 }, task))
    expect(max).toBe(2)
  })
})
