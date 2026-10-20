import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ExtractionReportRequest, PlaceReview } from '../../src/types/places.ts'
import { buildExtractionReport, extractionReportRequestSchema, fileReportWriter, reportSummary } from './extraction-report.ts'

const review = (overrides: Partial<PlaceReview> = {}): PlaceReview => ({
  unmappedFacts: [], doubts: [], anomalies: [], hoursRetry: { attempted: false, recovered: false, costUsd: 0 },
  logo: { status: 'missing', reason: 'no_instagram', kind: null }, ...overrides,
})
const stats = (overrides: Partial<ExtractionReportRequest['places'][number]['stats']> = {}) => ({
  hoursStatus: 'exact' as const, hasInstagram: true, hasWebsite: false, tagCount: 10, costUsd: 0.1, totalMs: 20_000,
  sourcesUsd: 0.06, mainLlmUsd: 0.04, hoursRetryUsd: 0, logoUsd: 0, inputTokens: 10_000, cachedInputTokens: 3_000, cacheWriteTokens: 0, ...overrides,
})

describe('reporte de extracción por lote', () => {
  it('agrupa los unmapped facts por proposedTag, con ejemplos, y cuenta los ignorados aparte', () => {
    const report = buildExtractionReport({
      places: [
        { name: 'El Patio', googlePlaceId: 'p1', stats: stats({ sourcesUsd: 0.0598, logoUsd: 0.0002 }), review: review({
          logo: { status: 'ok', reason: null, kind: 'logo' },
          unmappedFacts: [
            { id: 'F1', text: 'Jam de jazz los jueves', proposedTag: 'live_music' },
            { id: 'F2', text: 'Ciclo de charlas', proposedTag: 'events' },
            { id: 'F3', text: 'Fundado en 1921', proposedTag: null },
          ],
          doubts: ['¿Bar o centro cultural?'],
          anomalies: [{ type: 'hours_no_close', detail: 'lun desde 18:00' }],
        }) },
        { name: 'Ronda', googlePlaceId: 'p2', stats: stats({ hoursStatus: 'none', hasInstagram: false, hasWebsite: true, tagCount: 4, costUsd: 0.2, totalMs: 40_000, sourcesUsd: 0.1288, hoursRetryUsd: 0.0312, cacheWriteTokens: 3_000, cachedInputTokens: 0 }), review: review({
          unmappedFacts: [
            { id: 'F1', text: 'Talleres de collage', proposedTag: 'events' },
            { id: 'F2', text: 'Taller de escritura', proposedTag: 'events' },
            { id: 'F3', text: 'Taller de mindfulness', proposedTag: 'events' },
            { id: 'F4', text: 'Sirven cafés fríos', proposedTag: 'iced_coffee' },
          ],
          anomalies: [{ type: 'hours_vague', detail: 'none' }],
          hoursRetry: { attempted: true, recovered: false, costUsd: 0.0312 },
          logo: { status: 'failed', reason: 'upload_failed', kind: 'local' },
          rateLimits: [{ service: 'exa', retries: 3, waitedMs: 7000, recovered: false }, { service: 'llm', retries: 1, waitedMs: 1000, recovered: true }],
        }) },
        { name: 'Freddo', googlePlaceId: 'p3', reviewReasons: ['not_open_yet', 'restaurant_without_food'], stats: stats({ hoursStatus: 'partial', costUsd: 0.15, sourcesUsd: 0.0812, hoursRetryUsd: 0.0288 }), review: review({
          hoursRetry: { attempted: true, recovered: true, costUsd: 0.0288 },
          rateLimits: [{ service: 'llm', retries: 2, waitedMs: 3000, recovered: true }],
        }) },
        { name: 'Sin fuentes', googlePlaceId: 'p4', stats: stats({ hoursStatus: 'none', hasInstagram: false, tagCount: 0, costUsd: 0.05, totalMs: 4_000, sourcesUsd: 0.05, mainLlmUsd: 0, inputTokens: 0, cachedInputTokens: 0 }), review: null },
      ],
    })

    expect(Object.keys(report)).toEqual(['summary', 'byType', 'unmappedFactsByProposedTag'])
    expect(report.summary).toEqual({
      placesProcessed: 4,
      hours: { exact: 1, partial: 1, vague: 0, none: 2 },
      hoursRecoveredBySecondSearch: 1,
      hoursSecondSearchAttempted: 2,
      hoursSecondSearchCostUsd: 0.06,
      withInstagram: 2,
      withWebsite: 1,
      avgTags: 6,
      totalCostUsd: 0.5,
      avgSecondsPerPlace: 21,
      logos: { ok: 1, missing: 1, failed: 1, byKind: { logo: 1, local: 1 }, byReason: { upload_failed: 1, no_instagram: 1 } },
      // Las cuatro etapas suman el total.
      cost: { sourcesUsd: 0.3198, mainLlmUsd: 0.12, hoursSecondSearchUsd: 0.06, logoUsd: 0.0002, totalUsd: 0.5 },
      tokens: { input: 30_000, cachedInput: 6_000, cacheWrite: 3_000, cachedShare: 0.2 },
      rateLimits: { retries: { exa: 3, llm: 3 }, transientRetries: 0, places: 2, notRecovered: 1 },
      apifyErrors: { places: [], stopped: false },
      exaErrors: { places: [], stopped: false },
      instagramTieBreaks: {},
      review: { places: 1, byReason: { not_open_yet: 1, restaurant_without_food: 1 } },
    })
    expect(Object.keys(report.byType)).toEqual(['unmapped_fact', 'llm_doubt', 'hours_no_close', 'hours_vague', 'logo_failed'])
    // Sólo los logos que fallaron se revisan; los que faltan por no haber foto, no.
    expect(report.byType.logo_failed).toEqual([{ name: 'Ronda', googlePlaceId: 'p2', detail: 'upload_failed' }])
    expect(report.byType.unmapped_fact?.[0]).toEqual({ name: 'El Patio', googlePlaceId: 'p1', text: 'Jam de jazz los jueves', proposedTag: 'live_music' })
    expect(report.byType.dietary_fully).toBeUndefined()
    expect(report.unmappedFactsByProposedTag).toEqual([
      { proposedTag: 'events', existing: true, places: 2, facts: 4, examples: [
        { name: 'El Patio', text: 'Ciclo de charlas' },
        { name: 'Ronda', text: 'Talleres de collage' },
        { name: 'Ronda', text: 'Taller de escritura' },
      ] },
      { proposedTag: 'iced_coffee', existing: false, places: 1, facts: 1, examples: [{ name: 'Ronda', text: 'Sirven cafés fríos' }] },
      { proposedTag: 'live_music', existing: true, places: 1, facts: 1, examples: [{ name: 'El Patio', text: 'Jam de jazz los jueves' }] },
      { proposedTag: 'ignored', facts: 1 },
    ])
    expect(reportSummary(report)).toBe([
      '4 lugares · unmapped_fact: 7 · llm_doubt: 1 · hours_no_close: 1 · hours_vague: 1 · logo_failed: 1',
      'Horarios recuperados con la segunda búsqueda: 1 de 2 (USD 0.0600)',
      'A revisar: 1 (not_open_yet 1 · restaurant_without_food 1)',
      'Logos: 1 subidos · 1 sin foto usable · 1 con fallas',
      'Costo USD 0.5000: fuentes 0.3198 · LLM principal 0.1200 · segunda búsqueda 0.0600 · logo 0.0002',
      'Tokens cacheados: 6000 de 30000 (20%) · escritos en cache: 3000',
      'Límite de consultas (429): exa 3 reintentos · llm 3 reintentos · 2 lugares · 1 sin recuperar',
    ].join('\n'))
  })

  it('acepta el respaldo con las 6 variantes y el respaldo salteado por nombre no confirmado', () => {
    const place = (instagramFallback: PlaceReview['instagramFallback']) => ({ name: 'Olisa Café', googlePlaceId: 'place-1', stats: stats(), review: review({ instagramFallback }) })
    const parsed = extractionReportRequestSchema.safeParse({ places: [
      place({ attempted: true, reason: 'sin candidato', terms: ['Olisa Café', 'olisacafe', 'olisacafeuy', 'olisauy', 'olisacafemvd', 'olisamvd'], handles: [], costUsd: 0.06 }),
      place({ attempted: false, skipped: 'unconfirmed_name', reason: 'sin candidato', terms: [], handles: [], costUsd: 0 }),
    ] })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.places[1].review?.instagramFallback).toMatchObject({ skipped: 'unconfirmed_name' })
  })

  it('cuenta los errores de Apify, el corte del lote, los reintentos pasajeros y los desempates', () => {
    const parsed = extractionReportRequestSchema.parse({
      places: [{
        name: 'Cordón Beer', googlePlaceId: 'place-1', stats: stats(),
        review: review({
          rateLimits: [{ service: 'apify', retries: 0, transientRetries: 2, waitedMs: 20000, recovered: true }],
          instagramTieBreak: { rule: 'latest_post', pass: 'first', handles: ['cordonbeer', 'cordon.beer'] },
          instagramShared: [{ handle: 'lanocheuy_', places: ['place-2'] }],
        }),
      }, {
        name: 'Living Bar', googlePlaceId: 'place-7', stats: stats(),
        review: review({ instagramTieBreak: { rule: 'profile_picture', pass: 'fallback', handles: ['living.uy', 'living_uy'] } }),
      }],
      apifyErrors: ['place-3', 'place-4', 'place-5'],
      stoppedByApify: true,
      exaErrors: ['place-6'],
    })
    const report = buildExtractionReport(parsed)
    expect(report.summary.apifyErrors).toEqual({ places: ['place-3', 'place-4', 'place-5'], stopped: true })
    expect(report.summary.rateLimits.transientRetries).toBe(2)
    expect(report.summary.instagramTieBreaks).toEqual({ latest_post: 1, profile_picture: 1 })
    expect(reportSummary(report)).toContain('Error de Apify: 3 sin procesar · el lote se cortó')
    expect(report.summary.exaErrors).toEqual({ places: ['place-6'], stopped: false })
    expect(reportSummary(report)).toContain('Error de Exa: reintentar · 1 sin procesar')
    expect(reportSummary(report)).toContain('Reintentos de Apify por timeout o error: 2')
  })

  it('escribe output/report-<fecha-hora>.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-'))
    try {
      const report = buildExtractionReport({ places: [] })
      const path = await fileReportWriter(join(dir, 'output'))(report)
      expect(path).toMatch(/output\/report-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/)
      expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ summary: { placesProcessed: 0 }, byType: {}, unmappedFactsByProposedTag: [] })
      expect(reportSummary(report)).toMatch(/^0 lugares · sin casos/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
