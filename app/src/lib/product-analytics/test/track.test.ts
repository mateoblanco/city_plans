import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attach,
  clickTarget,
  currentSearchQuery,
  disableProductAnalytics,
  enableProductAnalytics,
  isAutomated,
  markSearchOrigin,
  resetProductAnalytics,
  sanitize,
  setCurrentSearchQuery,
  takeSearchOrigin,
  track,
  trackAttrs,
} from '../track'
import { pageType } from '../page-type'

afterEach(() => resetProductAnalytics())

const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

describe('track', () => {
  it('encola hasta que carga la librería y después manda en orden', () => {
    const client = { track: vi.fn(), pageView: vi.fn() }
    enableProductAnalytics('send')
    track('dish_clicked', { dish: 'Pizza' })
    track('guide_viewed', { guide: 'primera-cita' })
    expect(client.track).not.toHaveBeenCalled()
    attach(client)
    expect(client.track.mock.calls).toEqual([
      ['dish_clicked', { dish: 'Pizza' }],
      ['guide_viewed', { guide: 'primera-cita' }],
    ])
    track('intent_tab_selected', { tab: 'bars' })
    expect(client.track).toHaveBeenLastCalledWith('intent_tab_selected', { tab: 'bars' })
  })

  it('los eventos de antes de decidir (efectos de la página) se encolan y salen si se prende', () => {
    const client = { track: vi.fn(), pageView: vi.fn() }
    track('place_viewed', { place_id: 'p1', slug: 'uno', origin: 'direct', row: null })
    enableProductAnalytics('debug')
    attach(client)
    expect(client.track).toHaveBeenCalledWith('place_viewed', { place_id: 'p1', slug: 'uno', origin: 'direct', row: null })
  })

  it('sin la librería (desarrollo y previews: ProductAnalytics no se monta) no se manda nada', () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    track('dish_clicked', { dish: 'Pizza' })
    track('page_view', { page_type: 'home' })
    expect(fetcher).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('con un bot se descarta la cola y no se manda nada más', () => {
    const client = { track: vi.fn(), pageView: vi.fn() }
    track('dish_clicked', { dish: 'Pizza' })
    disableProductAnalytics()
    attach(client)
    track('guide_viewed', { guide: 'primera-cita' })
    expect(client.track).not.toHaveBeenCalled()
  })

  it('page_view va como el page view nativo de Mixpanel (track_pageview), no como evento propio', () => {
    const client = { track: vi.fn(), pageView: vi.fn() }
    enableProductAnalytics('send')
    attach(client)
    track('page_view', { page_type: 'place' })
    expect(client.pageView).toHaveBeenCalledWith({ page_type: 'place' })
    expect(client.track).not.toHaveBeenCalled()
  })

  it('un error de la librería no llega a la página', () => {
    enableProductAnalytics('send')
    attach({ track: () => { throw new Error('caída') }, pageView: () => { throw new Error('caída') } })
    expect(() => track('dish_clicked', { dish: 'Pizza' })).not.toThrow()
  })
})

describe('isAutomated', () => {
  it('bots por user agent y navegadores automatizados (navigator.webdriver)', () => {
    expect(isAutomated({ userAgent: PHONE, webdriver: false })).toBe(false)
    expect(isAutomated({ userAgent: PHONE, webdriver: true })).toBe(true)
    expect(isAutomated({ userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', webdriver: false })).toBe(true)
    expect(isAutomated({ userAgent: 'Mozilla/5.0 (Linux; Android 11) Chrome-Lighthouse', webdriver: false })).toBe(true)
    expect(isAutomated({ userAgent: '', webdriver: false })).toBe(true)
  })
})

describe('sanitize', () => {
  it('saca ubicación y guardados aunque se pasen, y recorta el texto a 100', () => {
    const clean = sanitize({
      query: 'a'.repeat(150),
      lat: -34.9,
      lng: -56.1,
      coords: '-34.9,-56.1',
      distance: 400,
      distance_m: 400,
      near: true,
      saved: ['p1'],
      saved_places: ['p1'],
      likes: ['p1'],
      userLocation: 'x',
      tab: 'all',
      missing: undefined,
    })
    expect(clean).toEqual({ query: 'a'.repeat(100), tab: 'all' })
  })

  it('track lo aplica', () => {
    const client = { track: vi.fn(), pageView: vi.fn() }
    enableProductAnalytics('send')
    attach(client)
    track('directions_clicked', { place_id: 'p1', slug: 'uno', ...({ lat: -34.9, lng: -56.1 } as object) } as never)
    expect(client.track).toHaveBeenCalledWith('directions_clicked', { place_id: 'p1', slug: 'uno' })
  })
})

describe('origen de la búsqueda', () => {
  it('lo marca lo que la dispara y se usa una vez; sin marca es link', () => {
    expect(takeSearchOrigin()).toBe('link')
    markSearchOrigin('bar')
    expect(takeSearchOrigin()).toBe('bar')
    expect(takeSearchOrigin()).toBe('link')
  })

  it('platos, "Ver todos" de una fila, filtros, pestañas y zona marcan su origen aunque la analítica esté apagada', () => {
    disableProductAnalytics()
    track('dish_clicked', { dish: 'Pizza' })
    expect(takeSearchOrigin()).toBe('dish')
    track('home_see_all_clicked', { row: 'dinner' })
    expect(takeSearchOrigin()).toBe('home_row')
    track('filter_changed', { filter: 'price', value: 'low' })
    expect(takeSearchOrigin()).toBe('filter')
    track('intent_tab_selected', { tab: 'eat' })
    expect(takeSearchOrigin()).toBe('tab')
    track('map_zone_search', {})
    expect(takeSearchOrigin()).toBe('zone')
    track('chip_removed', { filter: 'sub', chip: 'cocktails', from_text: true })
    expect(takeSearchOrigin()).toBe('filter')
  })

  it('guarda el texto de la búsqueda que se muestra', () => {
    setCurrentSearchQuery('pizza')
    expect(currentSearchQuery()).toBe('pizza')
  })
})

describe('trackAttrs y clickTarget', () => {
  const element = (attrs: Record<string, string> | null, parent: unknown = null) => ({
    getAttribute: (name: string) => attrs?.[name] ?? null,
    closest: (selector: string) => (selector === '[data-pa]' ? (attrs ? element(attrs) : parent) : null),
  })

  it('el link con data-pa da el evento y sus propiedades', () => {
    const attrs = trackAttrs('dish_clicked', { dish: 'Pizza' })
    expect(attrs).toEqual({ 'data-pa': 'dish_clicked', 'data-pa-props': '{"dish":"Pizza"}' })
    const link = element(attrs)
    const target = { closest: (selector: string) => (selector === 'a, button' ? link : null) }
    expect(clickTarget(target as unknown as EventTarget)).toEqual({ event: 'dish_clicked', props: { dish: 'Pizza' } })
  })

  it('un click fuera de un link o botón no cuenta', () => {
    const target = { closest: () => null }
    expect(clickTarget(target as unknown as EventTarget)).toBeNull()
    expect(clickTarget(null)).toBeNull()
  })
})

describe('pageType', () => {
  it('cada ruta con su tipo', () => {
    expect(pageType('/')).toBe('home')
    expect(pageType('/search')).toBe('search')
    expect(pageType('/place/escaramuza')).toBe('place')
    expect(pageType('/guides/montevideo')).toBe('guide')
    expect(pageType('/guides/montevideo/primera-cita')).toBe('guide')
    expect(pageType('/privacy')).toBe('legal')
    expect(pageType('/terms')).toBe('legal')
    expect(pageType('/otra')).toBe('other')
  })
})
