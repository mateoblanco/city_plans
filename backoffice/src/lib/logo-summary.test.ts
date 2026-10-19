import { describe, expect, it } from 'vitest'
import type { ExtractionRow } from '@/hooks/use-extraction-batch'
import type { PlaceEnrichmentResponse, PlaceReview } from '@/types/places'
import { LOGO_GROUPS, logoSummary } from './logo-summary'

type Audit = Partial<PlaceEnrichmentResponse['sourceAudit']>
const done = (name: string, logo: PlaceReview['logo'], extra: { audit?: Audit; fallback?: PlaceReview['instagramFallback'] } = {}): ExtractionRow => ({
  status: 'done',
  result: {
    source: 'llm', status: 'ok', place: { name },
    review: { logo, ...(extra.fallback ? { instagramFallback: extra.fallback } : {}) },
    sourceAudit: { instagram: false, instagramSelection: { handle: null, origin: null, candidates: [] }, ...extra.audit },
  } as unknown as PlaceEnrichmentResponse,
})
const rejected = (...candidates: [string, string][]): Audit => ({
  instagramSelection: { handle: null, origin: null, candidates: candidates.map(([handle, reason]) => ({ handle, decision: 'discarded', reason })) },
})

describe('logoSummary', () => {
  it('pone cada lugar en el grupo de su motivo, con el detalle', () => {
    const summary = logoSummary([
      done('Con Logo', { status: 'ok', reason: null, kind: 'logo' }),
      done('Foto del Local', { status: 'ok', reason: null, kind: 'local' }),
      done('Foto de Comida', { status: 'ok', reason: null, kind: 'food' }),
      done('Sin IG', { status: 'missing', reason: 'no_instagram', kind: null }),
      done('Sin URL', { status: 'missing', reason: 'no_picture', kind: null }),
      done('Prohibido', { status: 'failed', reason: 'download_failed', kind: null, detail: '403' }),
      done('Lento', { status: 'failed', reason: 'download_failed', kind: null, detail: 'timeout' }),
      done('Login', { status: 'missing', reason: 'not_image', kind: null, detail: 'text/html' }),
      done('Chica', { status: 'missing', reason: 'too_small', kind: null }),
      done('Silueta', { status: 'missing', reason: 'generic_avatar', kind: null }),
      done('Sin Clasificar', { status: 'failed', reason: 'classification_failed', kind: null }),
      done('Sin R2', { status: 'failed', reason: 'upload_failed', kind: 'logo' }),
      done('Selfie', { status: 'missing', reason: 'person_photo', kind: 'person' }),
      done('', { status: 'missing', reason: 'no_instagram', kind: null }),
      { status: 'done', result: { source: 'llm', status: 'no_sources', target: { name: 'Sin Fuentes' } } as unknown as PlaceEnrichmentResponse },
      { status: 'error', error: 'Falló' },
      { status: 'running' },
    ])

    expect(Object.keys(summary.groups)).toEqual(LOGO_GROUPS.map((group) => group.id))
    expect(summary.groups).toEqual({
      with_logo: [{ name: 'Con Logo', detail: null }],
      no_candidate: [{ name: 'Sin IG', detail: null }, { name: 'Sin nombre confirmado', detail: null }, { name: 'Sin Fuentes', detail: 'sin fuentes' }],
      instagram_rejected: [],
      no_picture: [{ name: 'Sin URL', detail: null }],
      download_failed: [{ name: 'Prohibido', detail: '403' }, { name: 'Lento', detail: 'timeout' }, { name: 'Login', detail: 'no es imagen, text/html' }],
      too_small: [{ name: 'Chica', detail: null }],
      generic_avatar: [{ name: 'Silueta', detail: null }],
      person_photo: [{ name: 'Selfie', detail: null }],
      not_logo: [{ name: 'Foto del Local', detail: 'Local' }, { name: 'Foto de Comida', detail: 'Comida' }],
      failed: [{ name: 'Sin Clasificar', detail: 'no se pudo clasificar' }, { name: 'Sin R2', detail: 'no se pudo subir a R2' }],
    })
    expect(summary.withoutStep).toBe(1)
    expect(summary.fallback).toEqual({ searched: 0, found: [] })
  })

  it('separa sin candidato de rechazado en la validación, con handle y motivo, y cuenta el respaldo', () => {
    const fallback = (handles: string[], reason = 'sin candidato') => ({ attempted: true, reason, terms: ['Marca'], handles, costUsd: 0.0135 })
    const summary = logoSummary([
      done('Sin Nada', { status: 'missing', reason: 'no_instagram', kind: null }, { fallback: fallback([]) }),
      done('Otro Perfil', { status: 'missing', reason: 'no_instagram', kind: null }, {
        audit: rejected(['otro.bar', 'identity_or_location_mismatch'], ['caido', 'not_returned_by_provider']),
      }),
      done('Rechazado Respaldo', { status: 'missing', reason: 'no_instagram', kind: null }, {
        audit: rejected(['rechazado.uy', 'identity_or_location_mismatch']), fallback: fallback(['rechazado.uy']),
      }),
      done('Encontrado', { status: 'ok', reason: null, kind: 'logo' }, {
        audit: { instagram: true }, fallback: fallback(['encontrado.uy']),
      }),
      done('Rescatado', { status: 'ok', reason: null, kind: 'logo' }, {
        audit: { instagram: true }, fallback: fallback(['rescatado.uy'], 'candidato rechazado: rescatado.uy, identity_or_location_mismatch'),
      }),
    ])

    expect(summary.groups.no_candidate).toEqual([{ name: 'Sin Nada', detail: null }])
    expect(summary.groups.instagram_rejected).toEqual([
      { name: 'Otro Perfil', detail: '@otro.bar: identity_or_location_mismatch, @caido: not_returned_by_provider' },
      { name: 'Rechazado Respaldo', detail: '@rechazado.uy: identity_or_location_mismatch (respaldo)' },
    ])
    expect(summary.groups.with_logo).toEqual([{ name: 'Encontrado', detail: null }, { name: 'Rescatado', detail: null }])
    expect(summary.fallback).toEqual({ searched: 4, found: [{ name: 'Encontrado', detail: null }, { name: 'Rescatado', detail: 'tras rechazo' }] })
  })

  it('sin nombre confirmado no se buscó: cuenta como sin candidato aunque la primera pasada rechazara alguno', () => {
    const skipped = (reason: string) => ({ attempted: false, skipped: 'unconfirmed_name' as const, reason, terms: [], handles: [], costUsd: 0 })
    const summary = logoSummary([
      done('', { status: 'missing', reason: 'no_instagram', kind: null }, { fallback: skipped('sin candidato') }),
      done('Con Rechazo', { status: 'missing', reason: 'no_instagram', kind: null }, {
        audit: rejected(['otro.bar', 'identity_or_location_mismatch']), fallback: skipped('candidato rechazado: otro.bar, identity_or_location_mismatch'),
      }),
    ])

    expect(summary.groups.no_candidate).toEqual([
      { name: 'Sin nombre confirmado', detail: 'sin búsqueda: nombre no confirmado' },
      { name: 'Con Rechazo', detail: 'sin búsqueda: nombre no confirmado' },
    ])
    expect(summary.groups.instagram_rejected).toEqual([])
    expect(summary.fallback).toEqual({ searched: 0, found: [] })
  })
})
