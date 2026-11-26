import { describe, expect, it, vi } from 'vitest'
import { BLOCKED_PROPERTIES, mixpanelConfig } from '../load'

describe('mixpanelConfig', () => {
  it('sin persistencia, sin IP, sin lotes en localStorage, sin captura automática ni URL completa', () => {
    for (const mode of ['send', 'debug'] as const) {
      const config = mixpanelConfig(mode)
      expect(config).toMatchObject({
        ip: false,
        disable_persistence: true,
        batch_requests: false,
        autocapture: false,
        track_pageview: false,
        save_referrer: false,
        track_marketing: false,
      })
      expect(config.property_blacklist).toEqual(BLOCKED_PROPERTIES)
      expect(BLOCKED_PROPERTIES).toContain('$current_url')
      expect(BLOCKED_PROPERTIES).toContain('$referrer')
      // La query del page view (q, y un near=lat,lng de un link viejo) y los parámetros de campaña.
      for (const key of ['current_url_search', 'utm_source', 'gclid', 'fbclid']) expect(BLOCKED_PROPERTIES).toContain(key)
    }
  })

  it('en debug escribe en la consola y no manda (el hook devuelve null)', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const hook = mixpanelConfig('debug').hooks?.before_send_events
    expect(hook?.({ event: 'dish_clicked', properties: { dish: 'Pizza' } })).toBeNull()
    expect(info).toHaveBeenCalledWith('[mixpanel]', 'dish_clicked', { dish: 'Pizza' })
    expect(mixpanelConfig('send').hooks?.before_send_events).toBeUndefined()
    info.mockRestore()
  })
})
