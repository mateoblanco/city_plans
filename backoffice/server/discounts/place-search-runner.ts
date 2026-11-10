import { isFoodPlaceType, seedCategoryForFoodPlaceType } from '../../src/data/food-place-types.ts'
import type { ReviewReason } from '../../src/data/review-reasons.ts'
import type { CategoryId } from '../../src/data/tags.ts'
import { rowSearch } from '../../src/lib/discount-missing.ts'
import { reportPlace } from '../../src/lib/extraction-report-entry.ts'
import { APIFY_FAILURE_LIMIT, EXA_FAILURE_LIMIT, EXTRACT_CONCURRENCY } from '../../src/lib/extraction-config.ts'
import { getBarrio } from '../../src/lib/getNeighborhood.ts'
import type { CandidateDetail, DiscountPlaceSearch, MissingRow, PlaceSearchCandidate, PlaceSearchJobRow, PlaceSearchProgress } from '../../src/types/discounts.ts'
import type { GooglePlaceDetailsResponse, PlaceEnrichmentResponse } from '../../src/types/places.ts'
import type { PlacesSaver } from '../places/save.ts'
import { buildExtractionReport, extractionReportRequestSchema, type ExtractionReportWriter } from '../providers/extraction-report.ts'
import { FIND_PLACE_USD } from '../providers/google-places-provider.ts'
import type { PlaceExtractor } from '../providers/place-extraction-service.ts'
import { ExaProviderFailure, InstagramProviderFailure, type FoundPlace, type PlaceFinder } from '../providers/places-provider.ts'
import { metersBetween } from './match.ts'
import { missingRows } from './missing.ts'
import type { DiscountStore } from './persist.ts'
import { chooseGoogleResult, searchQuery } from './place-search.ts'

/** El motivo que asegura que nada de esta búsqueda se publique solo. */
export const FROM_DISCOUNTS: ReviewReason = 'from_discounts'
export const MAX_SEARCH_ROWS = 200
export const STOPPED_BY_APIFY = 'No se procesó: la búsqueda se cortó por errores de Apify seguidos.'
export const STOPPED_BY_EXA = 'No se procesó: la búsqueda se cortó por errores de Exa seguidos.'
const NO_SOURCES = 'Las fuentes no trajeron datos del lugar: no se guardó.'

export type PlaceSearchDependencies = {
  store: DiscountStore
  finder: PlaceFinder
  /** Place Details (cacheado por el provider, el mismo que usa la extracción): el tipo de un candidato elegido a mano. */
  details?: { getDetails(placeId: string): Promise<GooglePlaceDetailsResponse> }
  extractor: Pick<PlaceExtractor, 'extract'>
  saver: Pick<PlacesSaver, 'save'>
  reportWriter?: ExtractionReportWriter
  now?: () => Date
  concurrency?: number
}

type Chosen = { placeId: string; lat: number; lng: number; primaryType: string | null }
type Task = { row: MissingRow; pick?: Chosen }
type Job = Extract<PlaceSearchProgress, { status: 'running' | 'done' }>

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Busca en Google los lugares de los proveedores que no están en la base y manda los claros al pipeline de extracción
 * (los mismos PlaceExtractionService y savePlaces de /api/extract y POST /api/places), siempre a "A revisar". Un
 * trabajo a la vez, en el servidor; la pantalla consulta status(). Nombre y dirección de Google sólo en memoria.
 */
export class DiscountPlaceSearchRunner {
  private job: Job | null = null
  private queue: Task[] = []
  private active = 0
  private apifyStreak = 0
  private exaStreak = 0
  private stopped: string | null = null
  private results: PlaceEnrichmentResponse[] = []
  private waiters: (() => void)[] = []
  /** Nombre, dirección y tipo de cada resultado de Google visto: sólo en memoria (como DiscoveryStore). */
  private readonly seen = new Map<string, CandidateDetail & { primaryType: string | null }>()
  private readonly deps: PlaceSearchDependencies
  private readonly now: () => Date
  private readonly concurrency: number

  constructor(deps: PlaceSearchDependencies) {
    this.deps = deps
    this.now = deps.now ?? (() => new Date())
    this.concurrency = deps.concurrency ?? EXTRACT_CONCURRENCY
  }

  status(): PlaceSearchProgress {
    if (!this.job) return { status: 'idle' }
    // Todos los vistos desde que arrancó el servidor: también los dudosos de trabajos anteriores.
    const candidateDetails: Record<string, CandidateDetail> = {}
    for (const [id, detail] of this.seen) candidateDetails[id] = { name: detail.name, address: detail.address }
    return structuredClone({ ...this.job, candidateDetails })
  }

  /** Arranca la búsqueda de esas filas. 'busy' si ya hay una corriendo; las claves que no existen, para el 400. */
  async start(rowKeys: string[]): Promise<{ jobId: string } | { busy: true } | { unknown: string[] }> {
    if (this.running()) return { busy: true }
    const rows = await this.rowsByKey()
    const unknown = rowKeys.filter((key) => !rows.has(key))
    if (unknown.length) return { unknown }
    // Puede haber arrancado otro mientras se leía la base.
    if (this.running()) return { busy: true }
    const started = this.now()
    this.job = { status: 'running', jobId: started.toISOString(), startedAt: started.toISOString(), finishedAt: null, rows: [], searches: 0, costUsd: 0, stopped: null, candidateDetails: {} }
    this.resetBatch()
    for (const key of [...new Set(rowKeys)]) this.enqueue({ row: rows.get(key)! })
    return { jobId: this.job.jobId }
  }

  /**
   * Elegir un candidato de un dudoso (lo manda a extracción, sumándolo al trabajo en curso o reabriendo el último) o
   * "Ninguno" (placeId null: queda no encontrado, sin llamadas).
   */
  async pick(rowKey: string, placeId: string | null): Promise<'ok' | 'not_found' | 'not_doubtful' | 'not_candidate'> {
    const row = (await this.rowsByKey()).get(rowKey)
    if (!row) return 'not_found'
    const search = rowSearch(row, await this.deps.store.placeSearches())
    if (!search || search.status !== 'doubtful') return 'not_doubtful'
    if (placeId === null) {
      await this.persist(row, { status: 'not_found', candidates: [] })
      this.updateRow(row, { state: 'done', outcome: 'not_found', candidates: [], error: null })
      return 'ok'
    }
    const candidate = search.candidates.find((item) => item.placeId === placeId)
    if (!candidate) return 'not_candidate'
    if (!this.job) {
      const started = this.now()
      this.job = { status: 'running', jobId: started.toISOString(), startedAt: started.toISOString(), finishedAt: null, rows: [], searches: 0, costUsd: 0, stopped: null, candidateDetails: {} }
      this.resetBatch()
    } else if (this.job.status === 'done') {
      this.job.status = 'running'
      this.job.finishedAt = null
      this.job.stopped = null
      this.resetBatch()
    }
    this.enqueue({ row, pick: { ...candidate, primaryType: this.seen.get(placeId)?.primaryType ?? null } })
    return 'ok'
  }

  /** Para tests: espera a que termine el trabajo en curso. */
  settled(): Promise<void> {
    if (this.job?.status !== 'running') return Promise.resolve()
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  private running() {
    return this.job?.status === 'running'
  }

  private resetBatch() {
    this.apifyStreak = 0
    this.exaStreak = 0
    this.stopped = null
    this.results = []
  }

  private async rowsByKey() {
    return new Map(missingRows(await this.deps.store.list()).map((row) => [row.key, row]))
  }

  private enqueue(task: Task) {
    this.updateRow(task.row, { state: 'queued', outcome: null, error: null, ...(task.pick ? {} : { candidates: [], candidateMeters: {} }) })
    this.queue.push(task)
    this.pump()
  }

  private pump() {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift()!
      this.active += 1
      void this.process(task).finally(() => {
        this.active -= 1
        this.pump()
        if (this.active === 0 && this.queue.length === 0) void this.finish()
      })
    }
  }

  private async finish() {
    if (!this.job || this.job.status !== 'running') return
    this.job.status = 'done'
    this.job.finishedAt = this.now().toISOString()
    this.job.stopped = this.stopped
    const results = this.results
    this.results = []
    const waiters = this.waiters
    this.waiters = []
    // Como el lote del barrido: el reporte en output/ (y así estas extracciones cuentan para el costo promedio).
    if (results.length && this.deps.reportWriter) {
      try {
        const request = extractionReportRequestSchema.parse({
          places: results.map(reportPlace),
          stoppedByApify: this.stopped === STOPPED_BY_APIFY,
          stoppedByExa: this.stopped === STOPPED_BY_EXA,
        })
        console.log(`Reporte de la búsqueda de descuentos: ${await this.deps.reportWriter(buildExtractionReport(request))}`)
      } catch (error) {
        console.error(JSON.stringify({ event: 'discount_search_report_error', message: message(error) }))
      }
    }
    for (const resolve of waiters) resolve()
  }

  private updateRow(row: MissingRow, patch: Partial<PlaceSearchJobRow>) {
    if (!this.job) return
    const current = this.job.rows.find((item) => item.rowKey === row.key)
    if (current) {
      Object.assign(current, patch)
      return
    }
    this.job.rows.push({
      rowKey: row.key, name: row.name, neighborhoodId: row.neighborhoodId, providerIds: row.providerIds, state: 'queued', outcome: null,
      candidates: [], candidateMeters: {}, googlePlaceId: null, ourPlace: null, error: null, costUsd: 0, ...patch,
    })
  }

  private addCost(row: MissingRow, usd: number) {
    if (!this.job) return
    this.job.costUsd = Math.round((this.job.costUsd + usd) * 10_000) / 10_000
    const current = this.job.rows.find((item) => item.rowKey === row.key)
    if (current) current.costUsd = Math.round((current.costUsd + usd) * 10_000) / 10_000
  }

  /** El mismo estado en cada local dueño de la fila. De Google, sólo place_id y coordenadas. */
  private async persist(row: MissingRow, patch: Partial<Omit<DiscountPlaceSearch, 'locationIndex' | 'searchedAt'>> & Pick<DiscountPlaceSearch, 'status'>) {
    const search: Omit<DiscountPlaceSearch, 'locationIndex'> = {
      searchedAt: this.now().toISOString(), googlePlaceId: null, location: null, candidates: [], placeId: null, error: null, ...patch,
    }
    await this.deps.store.setPlaceSearches(row.owners.map((owner) => ({ discountPlaceId: owner.discountPlaceId, search: { ...search, locationIndex: owner.locationIndex } })))
  }

  private async process(task: Task) {
    const { row } = task
    try {
      if (this.stopped) {
        await this.persist(row, { status: 'error', error: this.stopped })
        this.updateRow(row, { state: 'done', outcome: 'error', error: this.stopped })
        return
      }
      const chosen = task.pick ?? (await this.search(row))
      if (!chosen) return
      const location = { lat: chosen.lat, lng: chosen.lng }

      const [ours] = await this.deps.store.ourPlaces([chosen.placeId])
      if (ours) {
        await this.persist(row, { status: 'exists', googlePlaceId: chosen.placeId, location, placeId: ours.id })
        this.updateRow(row, { state: 'done', outcome: 'exists', googlePlaceId: chosen.placeId, ourPlace: { id: ours.id, name: ours.name, status: ours.status } })
        return
      }

      // Pudo cortarse mientras éste buscaba en Google.
      if (this.stopped) {
        await this.persist(row, { status: 'error', googlePlaceId: chosen.placeId, location, error: this.stopped })
        this.updateRow(row, { state: 'done', outcome: 'error', googlePlaceId: chosen.placeId, error: this.stopped })
        return
      }
      this.updateRow(row, { state: 'extracting', googlePlaceId: chosen.placeId })
      const result = await this.extract(chosen)
      this.results.push(result)
      this.addCost(row, result.performance.costUsd.totalUsd)
      if (result.status !== 'ok') {
        await this.persist(row, { status: 'error', googlePlaceId: chosen.placeId, location, error: NO_SOURCES })
        this.updateRow(row, { state: 'done', outcome: 'error', error: NO_SOURCES })
        return
      }
      // Siempre a revisión: los motivos del pipeline más el de descuentos.
      const place = { ...result.place, reviewReasons: [...new Set([...(result.place.reviewReasons ?? []), FROM_DISCOUNTS])] }
      const [saved] = await this.deps.saver.save([{ ...result, place }])
      if (!saved?.id || saved.action === 'skipped') {
        const error = saved?.error ?? 'No se pudo guardar el lugar.'
        await this.persist(row, { status: 'error', googlePlaceId: chosen.placeId, location, error })
        this.updateRow(row, { state: 'done', outcome: 'error', error })
        return
      }
      await this.persist(row, { status: 'review', googlePlaceId: chosen.placeId, location, placeId: saved.id })
      this.updateRow(row, { state: 'done', outcome: 'review', ourPlace: { id: saved.id, name: place.name, status: 'review' } })
    } catch (error) {
      const text = message(error)
      this.updateRow(row, { state: 'done', outcome: 'error', error: text })
      await this.persist(row, { status: 'error', error: text }).catch((persistError: unknown) => {
        console.error(JSON.stringify({ event: 'discount_search_persist_error', message: message(persistError) }))
      })
    }
  }

  /** Text Search y la elección. Devuelve el elegido, o null si quedó dudoso o no encontrado (ya guardado). */
  private async search(row: MissingRow): Promise<Chosen | null> {
    this.updateRow(row, { state: 'searching' })
    await this.persist(row, { status: 'searched' })
    const target = { name: row.name, neighborhoodId: row.neighborhoodId, address: row.address, coordinates: row.coordinates }
    const results = await this.deps.finder.findPlace({ query: searchQuery(target), near: row.coordinates })
    if (this.job) this.job.searches += 1
    this.addCost(row, FIND_PLACE_USD)
    for (const place of results) this.seen.set(place.placeId, { name: place.name, address: place.address, primaryType: place.primaryType })
    const choice = chooseGoogleResult(target, results)
    if (choice.kind === 'clear') return this.chosen(choice.place)
    if (choice.kind === 'not_found') {
      await this.persist(row, { status: 'not_found' })
      this.updateRow(row, { state: 'done', outcome: 'not_found' })
      return null
    }
    const candidates: PlaceSearchCandidate[] = choice.candidates.map((place) => ({ placeId: place.placeId, lat: place.lat, lng: place.lng }))
    const candidateMeters = row.coordinates
      ? Object.fromEntries(candidates.map((candidate) => [candidate.placeId, Math.round(metersBetween(row.coordinates!, candidate))]))
      : {}
    await this.persist(row, { status: 'doubtful', candidates })
    this.updateRow(row, { state: 'done', outcome: 'doubtful', candidates, candidateMeters })
    return null
  }

  private chosen(place: FoundPlace): Chosen {
    return { placeId: place.placeId, lat: place.lat, lng: place.lng, primaryType: place.primaryType }
  }

  /**
   * /api/extract en un paso ("Procesar sin revisar" del barrido), con la categoría semilla del tipo de Google y el
   * barrio de las coordenadas. Cuenta los errores seguidos de Apify y Exa, como el lote.
   */
  private async extract(chosen: Chosen): Promise<PlaceEnrichmentResponse> {
    let primaryType = chosen.primaryType
    if (!primaryType && this.deps.details) {
      // El mismo Place Details que pide la extracción (cacheado por el provider): no es una llamada más.
      const data = (await this.deps.details.getDetails(chosen.placeId)).data as { primaryType?: unknown } | null
      primaryType = typeof data?.primaryType === 'string' ? data.primaryType : null
    }
    const seed: CategoryId = primaryType && isFoodPlaceType(primaryType) ? seedCategoryForFoodPlaceType(primaryType) : 'restaurant'
    const neighborhoodId = getBarrio(chosen.lat, chosen.lng)
    try {
      const result = await this.deps.extractor.extract(chosen.placeId, { seedCategories: [seed], ...(neighborhoodId ? { neighborhoodId } : {}) })
      this.apifyStreak = 0
      this.exaStreak = 0
      return result
    } catch (error) {
      this.apifyStreak = error instanceof InstagramProviderFailure ? this.apifyStreak + 1 : 0
      this.exaStreak = error instanceof ExaProviderFailure ? this.exaStreak + 1 : 0
      if (this.apifyStreak >= APIFY_FAILURE_LIMIT) this.stopped ??= STOPPED_BY_APIFY
      if (this.exaStreak >= EXA_FAILURE_LIMIT) this.stopped ??= STOPPED_BY_EXA
      throw error
    }
  }
}
