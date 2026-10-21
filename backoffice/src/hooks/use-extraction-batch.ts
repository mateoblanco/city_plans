import { useCallback, useEffect, useRef, useState } from 'react'
import pMap from 'p-map'
import { APIFY_FAILURE_LIMIT, EXA_FAILURE_LIMIT, EXTRACT_CONCURRENCY } from '@/lib/extraction-config'
import { logoSummary, type LogoSummary } from '@/lib/logo-summary'
import { reviewSummary, type ReviewSummary } from '@/lib/review-summary'
import { initialDraft, instagramChoiceFor, type ReviewDraft } from '@/lib/instagram-review'
import { PlacesApiError, completePlace, discoverPlace, extractPlace, saveExtractionReport, type ExtractRequest } from '@/lib/places-api'
import type { ApiErrorCode, ExtractionReportRequest, InstagramDiscovery, PlaceEnrichmentResponse, PlaceExtractionPerformance } from '@/types/places'

/** discovering: paso 1 en curso; reviewing: esperando la revisión del Instagram para el paso 2. */
export type ExtractionStatus = 'queued' | 'discovering' | 'reviewing' | 'running' | 'done' | 'error'

/** En qué paso está (o falló) el lugar: en un paso (/api/extract), descubrimiento o extracción después de revisar. */
export type ExtractionPhase = 'extract' | 'discover' | 'complete'

export type ExtractionRow = {
  status: ExtractionStatus
  phase?: ExtractionPhase
  durationMs?: number
  result?: PlaceEnrichmentResponse
  /** Resultado del paso 1, para la revisión del Instagram. */
  discovery?: InstagramDiscovery
  /** El Instagram cargado a mano no existe: vuelve a la revisión con este mensaje. */
  instagramError?: string
  error?: string
  /** Código del error de la API; BATCH_STOPPED: no se procesó porque el lote se cortó. */
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

/** Handle de Instagram que eligió el lugar (en el resultado o en el descubrimiento), si eligió alguno. */
function selectedInstagram(row: ExtractionRow): string | null {
  const candidates = row.result?.sourceAudit.instagramSelection.candidates ?? row.discovery?.candidates ?? []
  return candidates.find((candidate) => candidate.decision === 'selected')?.handle ?? null
}

/** Cuentas descartadas por compartidas que informó el lugar, en el resultado o en el descubrimiento. */
function sharedOf(row: ExtractionRow) {
  if (row.result?.status === 'ok') return row.result.review.instagramShared ?? []
  return row.discovery?.shared ?? []
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
    for (const shared of sharedOf(row)) {
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

/** Un lugar del lote y el paso que le toca. */
type BatchJob = { request: ExtractRequest; phase: ExtractionPhase }

const ERROR_MESSAGE = 'No se pudo procesar el lugar.'

/**
 * Procesa lugares con p-map, cada uno con su request. En un paso (`run`, "Procesar sin revisar") o en dos: `discover`
 * deja los lugares en la revisión del Instagram y `complete` sigue con lo revisado. Los resultados viven sólo en este
 * estado; una falla no corta las demás, salvo APIFY_FAILURE_LIMIT errores de Apify seguidos (o EXA_FAILURE_LIMIT de
 * Exa): ahí deja de arrancar lugares (los que están corriendo terminan) y los que quedaban en cola pasan a error, para
 * reintentarlos.
 */
export function useExtractionBatch() {
  const [rows, setRows] = useState<Record<string, ExtractionRow>>({})
  const [running, setRunning] = useState(false)
  const [metrics, setMetrics] = useState<ExtractionBatchMetrics | null>(null)
  // Lo cargado en la revisión del Instagram, por lugar: sobrevive a los cambios de tab.
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({})
  const controllerRef = useRef<AbortController | null>(null)
  const requestsRef = useRef(new Map<string, ExtractRequest>())
  // Descubrimiento y duración del paso 1 por lugar: el paso 2 los conserva y suma los dos tiempos (sin la espera de
  // la revisión).
  const discoveriesRef = useRef(new Map<string, { discovery: InstagramDiscovery; durationMs: number }>())

  useEffect(() => () => controllerRef.current?.abort(), [])

  const execute = useCallback(async (jobs: readonly BatchJob[], choices: ReadonlyMap<string, ReturnType<typeof instagramChoiceFor>> = new Map()) => {
    if (jobs.length === 0) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    for (const { request } of jobs) requestsRef.current.set(request.googlePlaceId, request)
    const setRow = (id: string, row: ExtractionRow) => {
      if (!controller.signal.aborted) setRows((current) => ({ ...current, [id]: row }))
    }
    setRows((current) => {
      const next = { ...current }
      // En cola conserva el descubrimiento: si el lote se corta, el lugar vuelve a la revisión.
      for (const { request, phase } of jobs) next[request.googlePlaceId] = { status: 'queued', phase, discovery: discoveriesRef.current.get(request.googlePlaceId)?.discovery }
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
    const processOne = async ({ request, phase }: BatchJob) => {
      if (controller.signal.aborted || stoppedByApify || stoppedByExa) return
      const id = request.googlePlaceId
      started.add(id)
      const previous = discoveriesRef.current.get(id)
      setRow(id, { status: phase === 'discover' ? 'discovering' : 'running', phase, discovery: previous?.discovery })
      const requestStartedAt = performance.now()
      const elapsed = () => Math.round(performance.now() - requestStartedAt)
      let row: ExtractionRow
      try {
        if (phase === 'discover') {
          const discovery = await discoverPlace(request, controller.signal)
          discoveriesRef.current.set(id, { discovery, durationMs: elapsed() })
          row = { status: 'reviewing', phase, discovery }
        } else if (phase === 'complete') {
          const choice = choices.get(id)
          if (!choice || choice === 'invalid') throw new Error('El Instagram cargado no es válido.')
          const result = await completePlace(id, choice, controller.signal)
          row = { status: 'done', phase, durationMs: elapsed() + (previous?.durationMs ?? 0), result, discovery: previous?.discovery }
        } else {
          row = { status: 'done', phase, durationMs: elapsed(), result: await extractPlace(request, controller.signal) }
        }
      } catch (error) {
        if (controller.signal.aborted) return
        const errorCode = error instanceof PlacesApiError ? error.code : undefined
        const message = error instanceof Error ? error.message : ERROR_MESSAGE
        // Handle mal escrito: vuelve a la revisión con el error, sin perder el descubrimiento.
        row = phase === 'complete' && errorCode === 'INSTAGRAM_NOT_FOUND'
          ? { status: 'reviewing', phase: 'discover', discovery: previous?.discovery, instagramError: message }
          : { status: 'error', phase, durationMs: elapsed(), error: message, ...(errorCode ? { errorCode } : {}), discovery: previous?.discovery }
      }
      // Seguidos en el orden en que terminan: cualquier otro resultado corta la racha.
      apifyStreak = isApifyError(row) ? apifyStreak + 1 : 0
      if (apifyStreak >= APIFY_FAILURE_LIMIT) stoppedByApify = true
      exaStreak = isExaError(row) ? exaStreak + 1 : 0
      if (exaStreak >= EXA_FAILURE_LIMIT) stoppedByExa = true
      outcomes.set(id, row)
      setRow(id, row)
    }
    await pMap(jobs, processOne, { concurrency: EXTRACT_CONCURRENCY })
    if (controller.signal.aborted) return

    if (stoppedByApify || stoppedByExa) {
      for (const { request, phase } of jobs) {
        const id = request.googlePlaceId
        if (started.has(id)) continue
        const row: ExtractionRow = { status: 'error', phase, error: stoppedByApify ? BATCH_STOPPED_MESSAGE : BATCH_STOPPED_BY_EXA_MESSAGE, errorCode: 'BATCH_STOPPED', discovery: discoveriesRef.current.get(id)?.discovery }
        outcomes.set(id, row)
        setRow(id, row)
      }
    }

    // Una sola vuelta: los que se quedaron con una cuenta que después resultó compartida. Un descubrimiento se vuelve
    // a descubrir antes de la revisión; un resultado en un paso, a procesar. Los revisados no: ya se eligió a mano.
    const entries = () => [...outcomes].map(([id, row]) => ({ id, row }))
    const redo = stoppedByApify || stoppedByExa ? [] : sharedAccountsToRedo(entries())
    const redoIds = new Set(redo.flatMap((item) => item.ids))
    const redoJobs = jobs.filter((job) => redoIds.has(job.request.googlePlaceId) && job.phase !== 'complete')
    if (redoJobs.length > 0) {
      await pMap(redoJobs, processOne, { concurrency: EXTRACT_CONCURRENCY })
      if (controller.signal.aborted) return
    }

    controllerRef.current = null
    // Los descubiertos esperan la revisión: arrancan con el Instagram aprobado o el cargado a mano antes.
    const discovered = entries().filter((entry) => entry.row.status === 'reviewing' && entry.row.discovery && !entry.row.instagramError)
    if (discovered.length > 0) {
      setDrafts((current) => ({ ...current, ...Object.fromEntries(discovered.map((entry) => [entry.id, initialDraft(entry.row.discovery!)])) }))
    }
    setRunning(false)
    // Métricas y reporte cuando terminó alguna extracción; un lote que sólo descubrió espera la revisión.
    const finished = entries().filter((entry) => entry.row.status !== 'reviewing')
    if (!jobs.some((job) => job.phase !== 'discover')) return
    const sharedAccounts = redo.filter((item) => item.ids.some((id) => redoJobs.some((job) => job.request.googlePlaceId === id)))
      .map((item) => ({ handle: item.handle, reprocessed: item.ids }))
    setMetrics(batchMetrics(performance.now() - startedAt, finished, { stoppedByApify, stoppedByExa, sharedAccounts }))
    // El reporte es sólo un archivo del servidor: si falla, no afecta el lote.
    void Promise.resolve().then(() => saveExtractionReport(reportRequest(finished, { stoppedByApify, stoppedByExa }))).catch(() => {})
  }, [])

  /** En un paso, como antes de la revisión ("Procesar sin revisar"). */
  const run = useCallback((requests: readonly ExtractRequest[]) => execute(requests.map((request) => ({ request, phase: 'extract' }))), [execute])

  /** Paso 1: descubre los lugares y los deja en la revisión del Instagram. */
  const discover = useCallback((requests: readonly ExtractRequest[]) => execute(requests.map((request) => ({ request, phase: 'discover' }))), [execute])

  const setDraft = useCallback((id: string, draft: ReviewDraft) => {
    setDrafts((current) => ({ ...current, [id]: draft }))
    // Al corregir el handle se va el error de "no existe".
    setRows((current) => current[id]?.instagramError ? { ...current, [id]: { ...current[id], instagramError: undefined } } : current)
  }, [])

  const reviewing = Object.entries(rows).filter(([, row]) => row.status === 'reviewing' && row.discovery)
  const choices = new Map(reviewing.map(([id, row]) => [id, instagramChoiceFor(row.discovery!, drafts[id] ?? initialDraft(row.discovery!))]))
  const invalidCount = [...choices.values()].filter((choice) => choice === 'invalid').length

  /** Paso 2: la extracción de todos los lugares en revisión, con el Instagram elegido. */
  const complete = () => {
    if (invalidCount > 0) return Promise.resolve()
    const jobs = reviewing.flatMap(([id]) => requestsRef.current.get(id) ?? []).map((request): BatchJob => ({ request, phase: 'complete' }))
    return execute(jobs, choices)
  }

  /**
   * Cada fallido vuelve al paso en el que falló. Un paso 2 sin descubrimiento guardado (venció o se reinició el
   * servidor) vuelve a descubrirse.
   */
  const retryFailed = useCallback(() => {
    const failed = Object.entries(rows).filter(([, row]) => row.status === 'error')
    const jobs = failed.flatMap(([id, row]): BatchJob[] => {
      const request = requestsRef.current.get(id)
      if (!request) return []
      if (row.phase === 'complete' && row.errorCode !== 'DISCOVERY_EXPIRED' && row.discovery) return [{ request, phase: 'complete' }]
      return [{ request, phase: row.phase === 'extract' ? 'extract' : 'discover' }]
    })
    const failedChoices = new Map(failed.flatMap(([id, row]) => row.discovery ? [[id, instagramChoiceFor(row.discovery, drafts[id] ?? initialDraft(row.discovery))] as const] : []))
    return execute(jobs, failedChoices)
  }, [drafts, execute, rows])

  const reset = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    requestsRef.current.clear()
    discoveriesRef.current.clear()
    setRows({})
    setDrafts({})
    setMetrics(null)
    setRunning(false)
  }, [])

  const failedCount = Object.values(rows).filter((row) => row.status === 'error').length

  return { rows, running, metrics, failedCount, drafts, invalidCount, reviewCount: reviewing.length, run, discover, setDraft, complete, retryFailed, reset }
}
