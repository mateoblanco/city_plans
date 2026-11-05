import { describe, expect, it, vi } from 'vitest'
import { BRANCH_FIELD_MASK, contactWebsite, DETAILS_FIELD_MASK, fetchPlaceDetails, parseDetails, streetAddress, weekHours, whatsappHref } from '../google'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('fetchPlaceDetails', () => {
  it('pide sólo los campos del field mask, con la clave del servidor y sin caché', async () => {
    const fetchFn = vi.fn(async () => json({ rating: 4.5 }))
    const result = await fetchPlaceDetails('ChIJ/abc', ' clave ', fetchFn)

    expect(result).toEqual({ ok: true, data: { rating: 4.5 } })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.toString()).toBe('https://places.googleapis.com/v1/places/ChIJ%2Fabc?languageCode=es')
    expect(init.headers).toEqual({ 'X-Goog-Api-Key': 'clave', 'X-Goog-FieldMask': DETAILS_FIELD_MASK })
    expect(init.cache).toBe('no-store')
    expect(DETAILS_FIELD_MASK).toBe('rating,regularOpeningHours,shortFormattedAddress,websiteUri,internationalPhoneNumber')
  })

  it('un error HTTP trae el mensaje de Google', async () => {
    const fetchFn = vi.fn(async () => json({ error: { message: 'API key not valid.', status: 'INVALID_ARGUMENT' } }, 400))
    expect(await fetchPlaceDetails('x', 'k', fetchFn)).toEqual({ ok: false, error: 'Google respondió 400: API key not valid.' })
  })

  it('red caída o cuerpo inválido no tiran', async () => {
    const down = vi.fn(async () => {
      throw new Error('ECONNRESET')
    })
    expect(await fetchPlaceDetails('x', 'k', down)).toEqual({ ok: false, error: 'No se pudo conectar con Google (ECONNRESET).' })

    const html = vi.fn(async () => new Response('<html>', { status: 502 }))
    expect(await fetchPlaceDetails('x', 'k', html)).toEqual({ ok: false, error: 'Google respondió 502 con un cuerpo que no es JSON.' })
  })

  it('sin clave o sin place_id no llama a Google', async () => {
    const fetchFn = vi.fn(async () => json({}))
    expect(await fetchPlaceDetails('x', '  ', fetchFn)).toEqual({ ok: false, error: 'Falta configurar GOOGLE_PLACES_API_KEY.' })
    expect(await fetchPlaceDetails(null, 'k', fetchFn)).toEqual({ ok: false, error: 'El lugar no tiene google_place_id.' })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('dirección de una sucursal', () => {
  it('pide sólo shortFormattedAddress (SKU Essentials)', async () => {
    const fetchFn = vi.fn(async () => json({ shortFormattedAddress: 'Sarmiento 1345, Montevideo' }))
    await fetchPlaceDetails('abc', 'k', fetchFn, BRANCH_FIELD_MASK)
    const [, init] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit]
    expect(init.headers).toEqual({ 'X-Goog-Api-Key': 'k', 'X-Goog-FieldMask': 'shortFormattedAddress' })
  })

  it('se queda con la calle', () => {
    expect(streetAddress('Sarmiento 1345, 11300 Montevideo')).toBe('Sarmiento 1345')
    expect(streetAddress('  ')).toBeNull()
    expect(streetAddress(42)).toBeNull()
  })
})

const at = (day: number, hour: number, minute = 0) => ({ day, hour, minute })

describe('weekHours', () => {
  it('7 días de lunes a domingo, con dos franjas, un día cerrado y el cruce de medianoche', () => {
    const periods = [
      { open: at(2, 20), close: at(3, 0) },
      { open: at(2, 12), close: at(2, 15) },
      { open: at(5, 19, 30), close: at(6, 2) },
    ]
    const week = weekHours(periods)!
    expect(week.map((day) => day.day)).toEqual([1, 2, 3, 4, 5, 6, 0])
    expect(week[0]).toEqual({ day: 1, allDay: false, ranges: [] })
    expect(week[1].ranges).toEqual(['12:00 – 15:00', '20:00 – 00:00'])
    expect(week[4].ranges).toEqual(['19:30 – 02:00'])
  })

  it('un período sin cierre es abierto las 24 horas', () => {
    expect(weekHours([{ open: at(0, 0) }])!.every((day) => day.allDay)).toBe(true)
  })

  it('sin periods o con basura, null', () => {
    expect(weekHours(undefined)).toBeNull()
    expect(weekHours([])).toBeNull()
    expect(weekHours([{ open: { day: 9, hour: 'x' } }])).toBeNull()
  })
})

const EMPTY = { openNow: null, rating: null, address: null, week: null, website: null, whatsappHref: null }

describe('parseDetails', () => {
  it('lee abierto, puntaje, calle y semana', () => {
    const info = parseDetails({
      rating: 4.6,
      shortFormattedAddress: 'Sarmiento 1345, Montevideo',
      regularOpeningHours: { openNow: true, periods: [{ open: at(1, 10), close: at(1, 23) }] },
    })
    expect(info.openNow).toBe(true)
    expect(info.rating).toBe(4.6)
    expect(info.address).toBe('Sarmiento 1345')
    expect(info.week![0].ranges).toEqual(['10:00 – 23:00'])
  })

  it('una respuesta vacía o con otra forma no tira: todo null', () => {
    expect(parseDetails(null)).toEqual(EMPTY)
    expect(parseDetails({ rating: 'mucho', regularOpeningHours: { openNow: 'sí' } })).toEqual(EMPTY)
  })
})

describe('contacto', () => {
  it('lee web y WhatsApp del celular', () => {
    const info = parseDetails({
      websiteUri: 'https://www.lugar.com.uy/',
      internationalPhoneNumber: '+598 99 123 456',
    })
    expect(info.website).toBe('https://www.lugar.com.uy/')
    expect(info.whatsappHref).toBe('https://wa.me/59899123456')
  })

  it('Instagram no cuenta como web', () => {
    expect(contactWebsite('https://www.instagram.com/lugar/')).toBeNull()
    expect(contactWebsite('https://instagram.com/lugar')).toBeNull()
  })

  it('una web de WhatsApp va a WhatsApp y no a la web', () => {
    expect(contactWebsite('https://wa.me/59899123456')).toBeNull()
    expect(whatsappHref('https://wa.me/59899123456', null)).toBe('https://wa.me/59899123456')
    expect(whatsappHref('https://api.whatsapp.com/send?phone=59899123456', null)).toBe('https://api.whatsapp.com/send?phone=59899123456')
  })

  it('un fijo no da WhatsApp', () => {
    expect(whatsappHref(null, '+598 2900 1234')).toBeNull()
  })

  it('datos con otra forma quedan en null', () => {
    expect(contactWebsite('javascript:alert(1)')).toBeNull()
    expect(contactWebsite('no es url')).toBeNull()
    expect(contactWebsite(42)).toBeNull()
    expect(whatsappHref('ftp://wa.me/1', 'abc')).toBeNull()
    expect(parseDetails({ websiteUri: {}, internationalPhoneNumber: '+59 abc' })).toEqual(EMPTY)
  })
})
