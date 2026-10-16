import { describe, expect, it } from 'vitest'
import { SEARCH_CONFIG } from '../config'
import { interpretationRequest, SYSTEM_PROMPT } from '../llm'

describe('interpretationRequest', () => {
  it('cachea el mensaje de sistema fijo con TTL de 1 h y deja la consulta afuera', () => {
    const request = interpretationRequest('cafe tranquilo')
    expect(request.system.content).toBe(SYSTEM_PROMPT)
    expect(request.system.providerOptions.anthropic.cacheControl).toEqual({ type: 'ephemeral', ttl: '1h' })
    expect(SEARCH_CONFIG.llm.promptCacheTtl).toBe('1h')
    expect(request.prompt).toBe('Consulta: cafe tranquilo')
    expect(SYSTEM_PROMPT).not.toContain('cafe tranquilo')
    expect(request.reasoning).toBe('none')
  })
})
