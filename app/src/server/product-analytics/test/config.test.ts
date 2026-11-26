import { describe, expect, it } from 'vitest'
import { DEBUG_TOKEN, productAnalytics } from '../config'

describe('productAnalytics', () => {
  it('sólo envía en Production de Vercel con token', () => {
    expect(productAnalytics({ VERCEL_ENV: 'production', MIXPANEL_TOKEN: 'abc' })).toEqual({ mode: 'send', token: 'abc' })
    expect(productAnalytics({ VERCEL_ENV: 'production' })).toEqual({ mode: 'off' })
  })

  it('en previews y desarrollo no envía, aunque haya token', () => {
    expect(productAnalytics({ VERCEL_ENV: 'preview', MIXPANEL_TOKEN: 'abc' })).toEqual({ mode: 'off' })
    expect(productAnalytics({ VERCEL_ENV: 'development', MIXPANEL_TOKEN: 'abc' })).toEqual({ mode: 'off' })
    expect(productAnalytics({ NODE_ENV: 'development', MIXPANEL_TOKEN: 'abc' })).toEqual({ mode: 'off' })
    expect(productAnalytics({})).toEqual({ mode: 'off' })
  })

  it('debug fuera de producción, con un token de mentira (nunca el real)', () => {
    expect(productAnalytics({ MIXPANEL_DEBUG: 'true', MIXPANEL_TOKEN: 'abc' })).toEqual({ mode: 'debug', token: DEBUG_TOKEN })
    expect(productAnalytics({ VERCEL_ENV: 'preview', MIXPANEL_DEBUG: 'TRUE' })).toEqual({ mode: 'debug', token: DEBUG_TOKEN })
    expect(productAnalytics({ MIXPANEL_DEBUG: '1' })).toEqual({ mode: 'off' })
  })

  it('en producción debug no cuenta: con token envía, sin token nada', () => {
    expect(productAnalytics({ VERCEL_ENV: 'production', MIXPANEL_DEBUG: 'true', MIXPANEL_TOKEN: 'abc' })).toEqual({ mode: 'send', token: 'abc' })
    expect(productAnalytics({ VERCEL_ENV: 'production', MIXPANEL_DEBUG: 'true' })).toEqual({ mode: 'off' })
  })
})
