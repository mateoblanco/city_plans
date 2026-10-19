import { useCallback, useEffect, useRef, useState } from 'react'
import pMap from 'p-map'
import { APIFY_FAILURE_LIMIT, EXA_FAILURE_LIMIT, EXTRACT_CONCURRENCY } from '@/lib/extraction-config'
import { logoSummary, type LogoSummary } from '@/lib/logo-summary'
import { reviewSummary, type ReviewSummary } from '@/lib/review-summary'
import { PlacesApiError, extractPlace, saveExtractionReport, type ExtractRequest } from '@/lib/places-api'
import type { ApiErrorCode, ExtractionReportRequest, PlaceEnrichmentResponse, PlaceExtractionPerformance } from '@/types/places'

export type ExtractionStatus = 'queued' | 'running' | 'done' | 'error'

export type ExtractionRow = {
  status: ExtractionStatus
  durationMs?: number
  result?: PlaceEnrichmentResponse
  error?: string
  /** Código del error de /api/extract; BATCH_STOPPED: no se procesó porque el lote se cortó. */
  errorCode?: ApiErrorCode | 'BATCH_STOPPED'
}

/** Mensaje de las filas que quedaron en cola cuando el lote se cortó. */
export const BATCH_STOPPED_MESSAGE = 'No se procesó: el lote se cortó por errores de Apify.'
export const BATCH_STOPPED_BY_EXA_MESSAGE = 'No se procesó: el lote se cortó por errores de Exa.'

const isApifyError = (row: ExtractionRow) => row.status === 'error' && row.errorCode === 'INSTAGRAM_PROVIDER_ERROR'
const isExaError = (row: ExtractionRow) => row.status === 'error' && row.errorCode === 'EXA_PROVIDER_ERROR'

export type ExtractionStep = keyof PlaceExtractionPerformance['stepsMs']

export type ExtractionBatchMetrics = {
  totalMs: number
  averagePerPlaceMs: number | null
  averageStepsMs: Partial<Record<ExtractionStep, number>>
  done: number
  failed: number
  /** Paso del logo de cada lugar, agrupado por motivo. */
  logos: LogoSummary
  /** Lugares que se van a guardar con status review, por motivo. */
  review: ReviewSummary
  /** googlePlaceId de los que no se procesaron por un error de Apify: no se guardan, hay que reintentarlos. */
  apifyErrors: string[]
  /** El lote se cortó por APIFY_FAILURE_LIMIT errores de Apify seguidos. */
  stoppedByApify: boolean
  /** googlePlaceId de los que no se procesaron por un error de Exa: no se guardan, hay que reintentarlos. */
  exaErrors: string[]
  /** El lote se cortó por EXA_FAILURE_LIMIT errores de Exa seguidos. */
  stoppedByExa: boolean
  /** Cuentas de Instagram descartadas por compartidas entre lugares de distinta marca, y los lugares re-procesados. */
  sharedAccounts: { handle: string; reprocessed: string[] }[]
}

type BatchOutcome = { id: string; row: ExtractionRow }
type BatchExtras = Pick<ExtractionBatchMetrics, 'stoppedByApify' | 'stoppedByExa' | 'sharedAccounts'>

function batchMetrics(totalMs: number, entries: BatchOutcome[], extras: BatchExtras): ExtractionBatchMetrics {
  const outcomes = entries.map((entry) => entry.row)
  const done = outcomes.filter((row) => row.status === 'done')
  const average = (values: number[]) =>
    values.length > 0 ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null

  const stepValues: Partial<Record<ExtractionStep, number[]>> = {}
  for (const row of done) {
    for (const [step, value] of Object.entries(row.result?.performance.stepsMs ?? {})) {
      if (typeof value !== 'number') continue
      ;(stepValues[step as ExtractionStep] ??= []).push(value)
    }
  }
  const averageStepsMs: Partial<Record<ExtractionStep, number>> = {}
  for (const [step, values] of Object.entries(stepValues)) {
    const value = average(values)
    if (value !== null) averageStepsMs[step as ExtractionStep] = value
  }

  return {
    totalMs: Math.round(totalMs),
    averagePerPlaceMs: average(done.map((row) => row.durationMs ?? 0)),
    averageStepsMs,
    done: done.length,
    failed: outcomes.length - done.length,
    logos: logoSummary(outcomes),
    review: reviewSummary(outcomes),
    apifyErrors: entries.filter((entry) => isApifyError(entry.row)).map((entry) => entry.id),
    exaErrors: entries.filter((entry) => isExaError(entry.row)).map((entry) => entry.id),
    ...extras,
  }
}

/** Handle de Instagram que eligió el lugar, si eligió alguno. */
function selectedInstagram(row: ExtractionRow): string | null {
  return row.result?.sourceAudit.instagramSelection.candidates.find((candidate) => candidate.decision === 'selected')?.handle ?? null
}

/**
 * Carrera del lote: un lugar pudo quedarse con una cuenta agregadora antes de que otro lugar (de otra marca) la
 * tuviera como candidata. El que llegó segundo la informa en review.instagramShared con el primero; si el primero
 * la eligió, se re-procesa (el server ya la conoce como compartida y la descarta).
 */
function sharedAccountsToRedo(entries: BatchOutcome[]): { handle: string; ids: string[] }[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry.row]))
  const redo = new Map<string, Set<string>>()
  for (const { row } of entries) {
    if (row.result?.status !== 'ok') continue
    for (const shared of row.result.review.instagramShared ?? []) {
      for (const other of shared.places) {
        const otherRow = byId.get(other)
        if (otherRow && selectedInstagram(otherRow) === shared.handle) redo.set(shared.handle, (redo.get(shared.handle) ?? new Set()).add(other))
      }
    }
  }
  return [...redo].map(([handle, ids]) => ({ handle, ids: [...ids] }))
}

function reportRequest(entries: BatchOutcome[], { stoppedByApify, stoppedByExa }: Pick<BatchExtras, 'stoppedByApify' | 'stoppedByExa'>): ExtractionReportRequest {
  const outcomes = entries.map((entry) => entry.row)
  return {
    apifyErrors: entries.filter((entry) => isApifyError(entry.row)).map((entry) => entry.id),
    stoppedByApify,
    exaErrors: entries.filter((entry) => isExaError(entry.row)).map((entry) => entry.id),
    stoppedByExa,
    // Cada lugar terminado entra al resumen; sólo los que tuvieron fuentes traen review.
    places: outcomes.flatMap(({ status, result }): ExtractionReportRequest['places'] => {
      if (status !== 'done' || !result) return []
      const { totalUsd, providers } = result.performance.costUsd
      const mainLlmUsd = providers.llm.costUsd
      const hoursRetryUsd = result.status === 'ok' ? result.review.hoursRetry.costUsd : 0
      const logoUsd = providers.logo?.costUsd ?? 0
      const base = {
        costUsd: totalUsd,
        totalMs: result.performance.totalMs,
        sourcesUsd: Math.max(0, totalUsd - mainLlmUsd - hoursRetryUsd - logoUsd),
        mainLlmUsd,
        hoursRetryUsd,
        logoUsd,
        inputTokens: providers.llm.inputTokens ?? 0,
        cachedInputTokens: providers.llm.cachedInputTokens ?? 0,
        cacheWriteTokens: providers.llm.cacheWriteTokens ?? 0,
      }
      if (result.status !== 'ok') {
        return [{
          name: result.target.name, googlePlaceId: result.target.googlePlaceId, review: null,
          stats: { ...base, hoursStatus: 'none' as const, hasInstagram: false, hasWebsite: false, tagCount: 0 },
        }]
      }
      const { place } = result
      return [{
        // Sin nombre confirmado por las fuentes el reporte igual necesita uno; el de Google no se usa.
        name: place.name || 'Sin nombre confirmado', googlePlaceId: place.googlePlaceId, review: result.review,
        reviewReasons: place.reviewReasons ?? [],
        stats: {
          ...base,
          hoursStatus: place.hours.status,
          hasInstagram: Boolean(place.contact.instagram),
          hasWebsite: Boolean(place.contact.website),
          tagCount: place.tags.length,
        },
      }]
    }),
  }
}

/**
 * Procesa lugares con p-map: cada uno es una request independiente a /api/extract.
 * Los resultados viven sólo en este estado; una falla no corta las demás, salvo APIFY_FAILURE_LIMIT errores de
 * Apify seguidos (o EXA_FAILURE_LIMIT de Exa): ahí deja de arrancar lugares (los que están corriendo terminan) y los que quedaban en cola pasan a
 * error, para reintentarlos.
 */
export function useExtractionBatch() {
  const [rows, setRows] = useState<Record<string, ExtractionRow>>({})
  const [running, setRunning] = useState(false)
  const [metrics, setMetrics] = useState<ExtractionBatchMetrics | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const requestsRef = useRef(new Map<string, ExtractRequest>())

  useEffect(() => () => controllerRef.current?.abort(), [])

  const run = useCallback(async (requests: readonly ExtractRequest[]) => {
    if (requests.length === 0) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    for (const request of requests) requestsRef.current.set(request.googlePlaceId, request)
    const setRow = (id: string, row: ExtractionRow) => {
      if (!controller.signal.aborted) setRows((current) => ({ ...current, [id]: row }))
    }
    setRows((current) => {
      const next = { ...current }
      for (const request of requests) next[request.googlePlaceId] = { status: 'queued' }
      return next
    })
    setMetrics(null)
    setRunning(true)

    const startedAt = performance.now()
    const outcomes = new Map<string, ExtractionRow>()
    const started = new Set<string>()
    let apifyStreak = 0
    let stoppedByApify = false
    let exaStreak = 0
    let stoppedByExa = false
    const processOne = async (request: ExtractRequest) => {
      if (controller.signal.aborted || stoppedByApify || stoppedByExa) return
      started.add(request.googlePlaceId)
      setRow(request.googlePlaceId, { status: 'running' })
      const requestStartedAt = performance.now()
      let row: ExtractionRow
      try {
        const result = await extractPlace(request, controller.signal)
        row = { status: 'done', durationMs: Math.round(performance.now() - requestStartedAt), result }
      } catch (error) {
        if (controller.signal.aborted) return
        row = {
          status: 'error',
          durationMs: Math.round(performance.now() - requestStartedAt),
          error: error instanceof Error ? error.message : 'No se pudo procesar el lugar.',
          ...(error instanceof PlacesApiError ? { errorCode: error.code } : {}),
        }
      }
      // Seguidos en el orden en que terminan: cualquier otro resultado corta la racha.
      apifyStreak = isApifyError(row) ? apifyStreak + 1 : 0
      if (apifyStreak >= APIFY_FAILURE_LIMIT) stoppedByApify = true
      exaStreak = isExaError(row) ? exaStreak + 1 : 0
      if (exaStreak >= EXA_FAILURE_LIMIT) stoppedByExa = true
      outcomes.set(request.googlePlaceId, row)
      setRow(request.googlePlaceId, row)
    }
    await pMap(requests, processOne, { concurrency: EXTRACT_CONCURRENCY })
    if (controller.signal.aborted) return

    if (stoppedByApify || stoppedByExa) {
      for (const request of requests) {
        if (started.has(request.googlePlaceId)) continue
        const row: ExtractionRow = { status: 'error', error: stoppedByApify ? BATCH_STOPPED_MESSAGE : BATCH_STOPPED_BY_EXA_MESSAGE, errorCode: 'BATCH_STOPPED' }
        outcomes.set(request.googlePlaceId, row)
        setRow(request.googlePlaceId, row)
      }
    }

    // Una sola vuelta: los que se quedaron con una cuenta que después resultó compartida.
    const entries = () => [...outcomes].map(([id, row]) => ({ id, row }))
    const redo = stoppedByApify || stoppedByExa ? [] : sharedAccountsToRedo(entries())
    const redoIds = new Set(redo.flatMap((item) => item.ids))
    if (redoIds.size > 0) {
      await pMap(requests.filter((request) => redoIds.has(request.googlePlaceId)), processOne, { concurrency: EXTRACT_CONCURRENCY })
      if (controller.signal.aborted) return
    }

    controllerRef.current = null
    const sharedAccounts = redo.map((item) => ({ handle: item.handle, reprocessed: item.ids }))
    setMetrics(batchMetrics(performance.now() - startedAt, entries(), { stoppedByApify, stoppedByExa, sharedAccounts }))
    setRunning(false)
    // El reporte es sólo un archivo del servidor: si falla, no afecta el lote.
    void Promise.resolve().then(() => saveExtractionReport(reportRequest(entries(), { stoppedByApify, stoppedByExa }))).catch(() => {})
  }, [])

  const retryFailed = useCallback(() => {
    const failed = Object.entries(rows)
      .filter(([, row]) => row.status === 'error')
      .flatMap(([id]) => requestsRef.current.get(id) ?? [])
    return run(failed)
  }, [rows, run])

  const reset = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    requestsRef.current.clear()
    setRows({})
    setMetrics(null)
    setRunning(false)
  }, [])

  const failedCount = Object.values(rows).filter((row) => row.status === 'error').length

  return { rows, running, metrics, failedCount, run, retryFailed, reset }
}
