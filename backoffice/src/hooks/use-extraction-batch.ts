import { useCallback, useEffect, useRef, useState } from 'react'
import pMap from 'p-map'
import { EXTRACT_CONCURRENCY } from '@/lib/extraction-config'
import { extractPlace, saveExtractionReport, type ExtractRequest } from '@/lib/places-api'
import type { ExtractionReportRequest, PlaceEnrichmentResponse, PlaceExtractionPerformance } from '@/types/places'

export type ExtractionStatus = 'queued' | 'running' | 'done' | 'error'

export type ExtractionRow = {
  status: ExtractionStatus
  durationMs?: number
  result?: PlaceEnrichmentResponse
  error?: string
}

export type ExtractionStep = keyof PlaceExtractionPerformance['stepsMs']

export type ExtractionBatchMetrics = {
  totalMs: number
  averagePerPlaceMs: number | null
  averageStepsMs: Partial<Record<ExtractionStep, number>>
  done: number
  failed: number
}

function batchMetrics(totalMs: number, outcomes: ExtractionRow[]): ExtractionBatchMetrics {
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
  }
}

function reportRequest(outcomes: ExtractionRow[]): ExtractionReportRequest {
  return {
    // Cada lugar terminado entra al resumen; sólo los que tuvieron fuentes traen review.
    places: outcomes.flatMap(({ status, result }): ExtractionReportRequest['places'] => {
      if (status !== 'done' || !result) return []
      const { totalUsd, providers } = result.performance.costUsd
      const mainLlmUsd = providers.llm.costUsd
      const hoursRetryUsd = result.status === 'ok' ? result.review.hoursRetry.costUsd : 0
      const base = {
        costUsd: totalUsd,
        totalMs: result.performance.totalMs,
        sourcesUsd: Math.max(0, totalUsd - mainLlmUsd - hoursRetryUsd),
        mainLlmUsd,
        hoursRetryUsd,
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
        name: place.name, googlePlaceId: place.googlePlaceId, review: result.review,
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
 * Los resultados viven sólo en este estado; una falla no corta las demás.
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
    const outcomes: ExtractionRow[] = []
    await pMap(requests, async (request) => {
      if (controller.signal.aborted) return
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
        }
      }
      outcomes.push(row)
      setRow(request.googlePlaceId, row)
    }, { concurrency: EXTRACT_CONCURRENCY })

    if (controller.signal.aborted) return
    controllerRef.current = null
    setMetrics(batchMetrics(performance.now() - startedAt, outcomes))
    setRunning(false)
    // El reporte es sólo un archivo del servidor: si falla, no afecta el lote.
    void Promise.resolve().then(() => saveExtractionReport(reportRequest(outcomes))).catch(() => {})
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
