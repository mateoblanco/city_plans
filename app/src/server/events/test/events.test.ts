import { describe, expect, it, vi, beforeEach } from 'vitest'
import { addDays, montevideoDay, type Query } from '@shared/events.ts'
import { trackEvents } from '../config'
import { isBot } from '../bots'
import { daySalt, resetSaltCache, visitorCode } from '../visitor'
import { recordEvent } from '../record'
import { runDailySummary } from '../summary'

vi.mock('../../db', () => ({ getSql: () => { throw new Error('sin base en los tests') } }))

beforeEach(() => resetSaltCache())

describe('trackEvents (TRACK_EVENTS)', () => {
  it('sólo con "true": sin la variable (desarrollo y previews) queda apagado', () => {
    expect(trackEvents({})).toBe(false)
    expect(trackEvents({ TRACK_EVENTS: '' })).toBe(false)
    expect(trackEvents({ TRACK_EVENTS: 'false' })).toBe(false)
    expect(trackEvents({ TRACK_EVENTS: '1' })).toBe(false)
    expect(trackEvents({ TRACK_EVENTS: 'yes' })).toBe(false)
    expect(trackEvents({ NODE_ENV: 'development', VERCEL_ENV: 'preview' })).toBe(false)
    expect(trackEvents({ TRACK_EVENTS: 'true' })).toBe(true)
    expect(trackEvents({ TRACK_EVENTS: ' TRUE ' })).toBe(true)
  })
})

describe('isBot', () => {
  it('crawlers, previsualizadores, medición y clientes sin navegador; sin user agent también', () => {
    for (const ua of [
      '',
      null,
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0)',
      'facebookexternalhit/1.1',
      'WhatsApp/2.23.20.0',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36',
      'Mozilla/5.0 (Linux; Android 11; moto g power) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 Chrome-Lighthouse',
      'curl/8.4.0',
      'python-requests/2.31',
      'node-fetch/1.0',
    ]) {
      expect(isBot(ua), String(ua)).toBe(true)
    }
  })

  it('navegadores reales no', () => {
    for (const ua of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.1; rv:132.0) Gecko/20100101 Firefox/132.0',
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 Instagram 310.0',
    ]) {
      expect(isBot(ua), ua).toBe(false)
    }
  })
})

describe('día en Montevideo', () => {
  it('cambia a la medianoche de Montevideo (03:00 UTC), no a la de UTC', () => {
    expect(montevideoDay(new Date('2026-11-15T02:59:59Z'))).toBe('2026-11-14')
    expect(montevideoDay(new Date('2026-11-15T03:00:00Z'))).toBe('2026-11-15')
    expect(montevideoDay(new Date('2026-11-15T23:30:00Z'))).toBe('2026-11-15')
  })

  it('addDays cruza meses y años', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-11-15', -90)).toBe('2026-08-17')
  })
})

describe('código anónimo', () => {
  it('estable con la misma clave, IP y user agent; cambia con cualquiera de los tres', () => {
    const code = visitorCode('salt-1', '1.2.3.4', 'UA')
    expect(code).toMatch(/^[0-9a-f]{32}$/)
    expect(visitorCode('salt-1', '1.2.3.4', 'UA')).toBe(code)
    expect(visitorCode('salt-2', '1.2.3.4', 'UA')).not.toBe(code)
    expect(visitorCode('salt-1', '1.2.3.5', 'UA')).not.toBe(code)
    expect(visitorCode('salt-1', '1.2.3.4', 'UA2')).not.toBe(code)
    // El separador evita que "ab"+"c" y "a"+"bc" den lo mismo.
    expect(visitorCode('s', 'ab', 'c')).not.toBe(visitorCode('s', 'a', 'bc'))
  })

  it('la clave del día se pide una vez por día y por instancia; sin fila nueva, se vuelve a leer', async () => {
    const run = vi.fn(async (query: Query) => (query.text.includes('insert') ? [] : [{ salt: 'ff' }]))
    expect(await daySalt('2026-11-15', run)).toBe('ff')
    expect(await daySalt('2026-11-15', run)).toBe('ff')
    expect(run).toHaveBeenCalledTimes(2)
    // La clave propuesta es aleatoria, de 32 bytes.
    expect(run.mock.calls[0][0].params[1]).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('recordEvent', () => {
  it('nunca manda la IP ni el user agent a la base: sólo el código', async () => {
    const run = vi.fn(async (query: Query) => (query.text.includes('event_salts') ? [{ salt: 'ab' }] : []))
    await recordEvent(
      { placeId: 'p', type: 'view', origin: 'home', row: 'breakfast' },
      { ip: '203.0.113.9', userAgent: 'Mozilla/5.0 Secreto' },
      run,
      new Date('2026-11-15T12:00:00Z'),
    )
    const insert = run.mock.calls.at(-1)![0]
    expect(insert.params.slice(0, 6)).toEqual(['p', 'view', visitorCode('ab', '203.0.113.9', 'Mozilla/5.0 Secreto'), '2026-11-15', 'home', 'breakfast'])
    const sent = JSON.stringify(run.mock.calls)
    expect(sent).not.toContain('203.0.113.9')
    expect(sent).not.toContain('Secreto')
  })

  it('la fila de la home sólo se guarda con origen home o saved', async () => {
    const run = vi.fn(async (query: Query) => (query.text.includes('event_salts') ? [{ salt: 'ab' }] : []))
    await recordEvent({ placeId: 'p', type: 'view', origin: 'search', row: 'breakfast' }, { ip: '', userAgent: '' }, run)
    expect(run.mock.calls.at(-1)![0].params[5]).toBeNull()
  })
})

describe('runDailySummary (cron)', () => {
  it('resume los 3 días cerrados (hasta ayer), borra eventos de más de 90 días y las claves viejas', async () => {
    const run = vi.fn<(query: Query) => Promise<Record<string, unknown>[]>>(async () => [])
    const result = await runDailySummary(run, new Date('2026-11-15T04:00:00Z'))
    const [summary, events, salts] = run.mock.calls.map(([query]) => query)
    expect(summary.text).toContain('insert into place_event_daily')
    expect(summary.params).toEqual(['2026-11-12', '2026-11-15'])
    expect(events.text).toContain('delete from place_events')
    expect(events.params).toEqual(['2026-08-17'])
    expect(salts.text).toContain('delete from event_salts')
    expect(salts.params).toEqual(['2026-11-15'])
    expect(result).toEqual({ summarized: { from: '2026-11-12', to: '2026-11-14' }, deletedBefore: '2026-08-17' })
  })
})
