import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

const sendEvent = vi.fn()
// El import() de track.ts resuelve a este mock.
vi.mock('../../utils/send', () => ({ sendEvent }))

const { default: PlaceViewBeacon } = await import('../PlaceViewBeacon')

describe('PlaceViewBeacon en el servidor', () => {
  it('el render del servidor (y el payload del prefetch, que sólo se renderiza) no cuenta la vista', () => {
    vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const html = renderToString(createElement(PlaceViewBeacon, { placeId: 'id-1', slug: 'cafe-uno' }))
    expect(html).toBe('')
    expect(sendEvent).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
