import { describe, expect, it, vi } from 'vitest'
import { checkStatuses, statusWrites, type StatusRow } from './status-check.ts'

function row(id: string, overrides: Partial<StatusRow> = {}): StatusRow {
  return { id, googlePlaceId: `place-${id}`, name: `Lugar ${id}`, neighborhoodId: 'pocitos', reviewReasons: [], manualOverrides: {}, ...overrides }
}

const STATUSES: Record<string, string | null> = {
  'place-open': 'OPERATIONAL',
  'place-temp': 'CLOSED_TEMPORARILY',
  'place-perm': 'CLOSED_PERMANENTLY',
  'place-none': null,
  'place-gone': 'NOT_FOUND',
}

const fakeGoogle = vi.fn(async (placeId: string) => {
  if (placeId === 'place-boom') throw new Error('Google Places no pudo completar la solicitud.')
  return STATUSES[placeId] ?? null
})

describe('checkStatuses', () => {
  it('lista los cerrados con su motivo, los no encontrados y los errores; los abiertos y sin dato no', async () => {
    const rows = [row('open'), row('temp'), row('perm'), row('none'), row('gone'), row('boom')]
    const verdicts = await checkStatuses(rows, fakeGoogle)
    expect(verdicts.map((verdict) => [verdict.row.id, verdict.kind, verdict.kind === 'closed' ? verdict.reason : null])).toEqual([
      ['temp', 'closed', 'closed_temporarily'],
      ['perm', 'closed', 'closed_permanently'],
      ['gone', 'not_found', null],
      ['boom', 'error', null],
    ])
    expect(fakeGoogle).toHaveBeenCalledTimes(rows.length)
  })

  it('marca el status puesto a mano', async () => {
    const [verdict] = await checkStatuses([row('perm', { manualOverrides: { status: 'published', review_reasons: [] } })], fakeGoogle)
    expect(verdict).toMatchObject({ kind: 'closed', manual: true })
  })
})

describe('statusWrites', () => {
  it('suma el motivo a los que tenía y saltea los de status a mano salvo --override', async () => {
    const rows = [
      row('temp', { reviewReasons: ['low_rating'] }),
      row('perm', { manualOverrides: { status: 'published', review_reasons: [] } }),
      row('open'),
      row('gone'),
    ]
    const verdicts = await checkStatuses(rows, fakeGoogle)
    expect(statusWrites(verdicts, new Set())).toEqual([{ id: 'temp', reviewReasons: ['low_rating', 'closed_temporarily'], clearManualStatus: false }])
    expect(statusWrites(verdicts, new Set(['perm']))).toEqual([
      { id: 'temp', reviewReasons: ['low_rating', 'closed_temporarily'], clearManualStatus: false },
      { id: 'perm', reviewReasons: ['closed_permanently'], clearManualStatus: true },
    ])
  })

  it('no duplica un motivo que ya tenía', async () => {
    const verdicts = await checkStatuses([row('temp', { reviewReasons: ['closed_temporarily'] })], fakeGoogle)
    expect(statusWrites(verdicts, new Set())[0].reviewReasons).toEqual(['closed_temporarily'])
  })
})
