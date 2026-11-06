import type { DiscountProvider, DiscountRun, DiscountRunProgress, DiscountRunProvider } from '../../src/types/discounts.ts'
import type { MatchablePlace } from './match.ts'
import { planDiscountWrites, type DiscountStore } from './persist.ts'
import type { PageFetcher } from './polite-fetch.ts'
import type { ProviderReader } from './reader.ts'
import type { BenefitStructurer } from './structure-benefits.ts'

export const DEFAULT_DISCOUNTS_DIR = 'cache/discounts'

export type RunDependencies = {
  providers: readonly DiscountProvider[]
  readers: Record<string, ProviderReader>
  /** El fetcher de cada proveedor en esta corrida (en vivo, o desde el HTML crudo de otra). */
  fetcherFor: (runId: string, providerId: string) => Promise<PageFetcher>
  /** Nuestros lugares, para el cruce (sólo lectura). */
  candidates: () => Promise<MatchablePlace[]>
  structure?: BenefitStructurer
  store: DiscountStore
  now?: () => Date
  onProgress?: (progress: Extract<DiscountRunProgress, { status: 'running' }>) => void
}

export const newRunId = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')

/**
 * Corre todos los proveedores y guarda cada uno en la base (upsert, inactivos, cruce de lo automático). Un proveedor
 * que falla entero no escribe nada (no se confunde "no pude leer" con "desapareció") y no corta a los demás.
 */
export async function runDiscounts(deps: RunDependencies, options: { runId?: string; reparsedFrom?: string } = {}): Promise<DiscountRun> {
  const now = deps.now ?? (() => new Date())
  const started = now()
  const runId = options.runId ?? newRunId(started)
  const providers: DiscountRunProvider[] = []
  const errors: DiscountRun['errors'] = []
  const warnings: string[] = []
  let candidates: MatchablePlace[] | null = null

  for (const provider of deps.providers) {
    const reader = deps.readers[provider.id]
    let fetcher: PageFetcher | null = null
    const base = { providerId: provider.id, name: provider.name, kind: provider.kind }
    try {
      if (!reader) throw new Error(`No hay lector para ${provider.name}.`)
      fetcher = await deps.fetcherFor(runId, provider.id)
      const result = await reader({
        provider,
        fetcher,
        structure: deps.structure,
        onProgress: (progress) => deps.onProgress?.({ status: 'running', runId, startedAt: started.toISOString(), providerId: provider.id, ...progress }),
      })
      deps.onProgress?.({ status: 'running', runId, startedAt: started.toISOString(), providerId: provider.id, phase: 'matching', done: 0, total: result.places.length })
      // Sin la lista de nuestros lugares no se puede cruzar: mejor no escribir que dejar todo en "no está".
      candidates ??= await deps.candidates()
      const writes = planDiscountWrites({ providerId: provider.id, runId, now: started, result, existing: await deps.store.existing(provider.id), candidates })
      await deps.store.apply(writes)
      errors.push(...result.errors)
      warnings.push(...result.warnings)
      providers.push({ ...base, status: result.errors.length ? 'partial' : 'ok', places: result.places.length, requests: fetcher.requests, llm: result.llm, ...(result.notes?.length ? { notes: result.notes } : {}) })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      providers.push({ ...base, status: 'error', places: 0, error: message, requests: fetcher?.requests ?? 0, llm: { calls: 0, costUsd: 0 } })
    }
  }

  const run: DiscountRun = {
    id: runId,
    startedAt: started.toISOString(),
    finishedAt: now().toISOString(),
    reparsedFrom: options.reparsedFrom ?? null,
    providers,
    errors,
    warnings,
  }
  await deps.store.saveRun(run)
  return run
}

/** Una corrida a la vez, en el servidor; la pantalla consulta el progreso. */
export class DiscountRunner {
  private progress: DiscountRunProgress = { status: 'idle' }
  private current: Promise<void> | null = null
  private readonly deps: RunDependencies

  constructor(deps: RunDependencies) {
    this.deps = deps
  }

  status(): DiscountRunProgress {
    return this.progress
  }


  /** Arranca una corrida y devuelve su id; null si ya hay una corriendo. */
  start(): string | null {
    if (this.current) return null
    const startedAt = (this.deps.now ?? (() => new Date()))()
    const runId = newRunId(startedAt)
    this.progress = { status: 'running', runId, startedAt: startedAt.toISOString(), providerId: this.deps.providers[0]?.id ?? '', phase: 'listing', done: 0, total: null }
    this.current = runDiscounts({ ...this.deps, onProgress: (progress) => { this.progress = progress } }, { runId })
      .then((run) => {
        const failed = run.providers.every((provider) => provider.status === 'error')
        this.progress = failed
          ? { status: 'error', runId, finishedAt: run.finishedAt, message: run.providers.map((provider) => provider.error).filter(Boolean).join(' · ') || 'La corrida no trajo lugares.' }
          : { status: 'done', runId, finishedAt: run.finishedAt }
      })
      .catch((error: unknown) => {
        this.progress = { status: 'error', runId, finishedAt: new Date().toISOString(), message: error instanceof Error ? error.message : String(error) }
      })
      .finally(() => {
        this.current = null
      })
    return runId
  }

  /** Para tests: espera a que termine la corrida en curso. */
  async settled() {
    await this.current
  }
}

/** Lo que usan los endpoints de descuentos: la corrida, lo guardado y nuestros lugares (para volver a cruzar). */
export type DiscountsService = {
  runner: DiscountRunner
  store: DiscountStore
  candidates: () => Promise<MatchablePlace[]>
}
