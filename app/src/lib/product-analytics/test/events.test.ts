import { describe, expect, expectTypeOf, it } from 'vitest'
import { PRODUCT_EVENTS, type ProductEvent, type ProductEvents } from '../events'
import { FORBIDDEN_KEY, track } from '../track'

/** Un ejemplo de cada evento del tracking plan: si se agrega un evento sin ejemplo, `tsc` falla. */
const SAMPLES: { [E in ProductEvent]: ProductEvents[E] } = {
  page_view: { page_type: 'place' },
  search_submitted: { query: 'Pizza ', query_normalized: 'pizza', origin: 'bar', tab: 'all', filters: { location: ['near'] }, results_count: 12, resolved_by: 'dictionary', has_location: true },
  search_no_results: { query: 'xyz', query_normalized: 'xyz', origin: 'link', tab: 'eat', filters: {}, results_count: 0, resolved_by: 'llm', has_location: false },
  filter_changed: { filter: 'price', value: 'low' },
  intent_tab_selected: { tab: 'bars' },
  search_result_clicked: { place_id: 'p1', slug: 'uno', position: 3, surface: 'map', query: 'pizza' },
  map_zone_search: {},
  results_load_more: { visible_count: 12, total_count: 40, page: 2 },
  map_marker_clicked: { place_id: 'p1', slug: 'uno', position: 4 },
  chip_removed: { filter: 'open', chip: 'now', from_text: true },
  place_viewed: { place_id: 'p1', slug: 'uno', origin: 'search', row: null },
  place_saved: { place_id: 'p1', slug: 'uno', origin: 'home' },
  place_unsaved: { place_id: 'p1', slug: 'uno', origin: 'direct' },
  directions_clicked: { place_id: 'p1', slug: 'uno' },
  share_clicked: { place_id: 'p1', slug: 'uno', method: 'whatsapp' },
  external_link_clicked: { place_id: 'p1', slug: 'uno', link: 'instagram' },
  discount_info_clicked: { place_id: 'p1', slug: 'uno', bank: 'itau' },
  home_row_clicked: { place_id: 'p1', slug: 'uno', row: 'dinner', position: 2 },
  home_see_all_clicked: { row: 'dinner' },
  dish_clicked: { dish: 'Pizza' },
  guide_viewed: { guide: 'primera-cita' },
  guide_place_clicked: { place_id: 'p1', slug: 'uno', guide: 'primera-cita', position: 1 },
  location_permission: { result: 'granted' },
  welcome_completed: { cards: ['itau.credit'] },
  welcome_skipped: { step: 'cards' },
}

const keysOf = (value: unknown): string[] =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value).flatMap(([key, child]) => [key, ...keysOf(child)]) : []

describe('tracking plan', () => {
  it('PRODUCT_EVENTS lista todos los eventos de los tipos, sin repetir', () => {
    expect([...PRODUCT_EVENTS].sort()).toEqual(Object.keys(SAMPLES).sort())
    expect(new Set(PRODUCT_EVENTS).size).toBe(PRODUCT_EVENTS.length)
    expectTypeOf<(typeof PRODUCT_EVENTS)[number]>().toEqualTypeOf<ProductEvent>()
  })

  it('ninguna propiedad se llama como la ubicación de la persona o sus guardados', () => {
    for (const [event, props] of Object.entries(SAMPLES)) {
      for (const key of keysOf(props)) expect(FORBIDDEN_KEY.test(key), `${event}.${key}`).toBe(false)
    }
  })

  it('track sólo acepta eventos y propiedades del tracking plan', () => {
    // Si alguno de estos compila, el helper dejó de estar tipado (tsc falla por el @ts-expect-error sin uso).
    const typed = () => {
      // @ts-expect-error evento que no existe
      track('search_done', {})
      // @ts-expect-error falta una propiedad obligatoria
      track('dish_clicked', {})
      // @ts-expect-error valor fuera de la lista
      track('share_clicked', { place_id: 'p1', slug: 'uno', method: 'email' })
      // @ts-expect-error propiedad que no está en el plan (coordenadas)
      track('directions_clicked', { place_id: 'p1', slug: 'uno', lat: -34.9 })
    }
    expect(typed).toBeTypeOf('function')
  })
})
