import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { groupOf } from '../../src/data/tags.ts'
import { LOGO_KINDS } from '../../src/data/place-schema.ts'
import { REVIEW_REASON_IDS, type ReviewReason } from '../../src/data/review-reasons.ts'
import type { ExtractionReportRequest, InstagramTieBreakRule, LogoIssue, PlaceReviewAnomalyType } from '../../src/types/places.ts'

export const REVIEW_ANOMALY_TYPES = [
  'hours_vague',
  'hours_no_close',
  'bar_without_drinks',
  'restaurant_without_food',
  'dietary_fully',
  'no_contact',
  'cuisine_unmentioned',
] as const satisfies readonly PlaceReviewAnomalyType[]

export const LOGO_ISSUES = [
  'no_instagram',
  'no_picture',
  'download_failed',
  'not_image',
  'too_small',
  'generic_avatar',
  'classification_failed',
  'processing_failed',
  'storage_not_configured',
  'upload_failed',
  'person_photo',
] as const satisfies readonly LogoIssue[]

const MAX_REPORT_PLACES = 2000
const TIE_BREAK_RULES = ['first_pass_candidate', 'gastronomy', 'profile_picture', 'latest_post', 'followers', 'unresolved'] as const satisfies readonly InstagramTieBreakRule[]
const text = z.string().trim().min(1).max(1000)

export const extractionReportRequestSchema = z.object({
  places: z.array(z.object({
    name: z.string().trim().min(1).max(300),
    googlePlaceId: z.string().trim().min(1).max(300),
    stats: z.object({
      hoursStatus: z.enum(['exact', 'partial', 'vague', 'none']),
      hasInstagram: z.boolean(),
      hasWebsite: z.boolean(),
      tagCount: z.number().int().min(0).max(500),
      costUsd: z.number().min(0).max(100),
      totalMs: z.number().min(0).max(3_600_000),
      sourcesUsd: z.number().min(0).max(100),
      mainLlmUsd: z.number().min(0).max(100),
      hoursRetryUsd: z.number().min(0).max(100),
      logoUsd: z.number().min(0).max(100).default(0),
      inputTokens: z.number().int().min(0),
      cachedInputTokens: z.number().int().min(0),
      cacheWriteTokens: z.number().int().min(0),
    }),
    review: z.object({
      unmappedFacts: z.array(z.object({ id: z.string().max(20), text, proposedTag: z.string().max(60).nullable() })).max(100),
      doubts: z.array(text).max(5),
      anomalies: z.array(z.object({ type: z.enum(REVIEW_ANOMALY_TYPES), detail: z.string().max(1000) })).max(20),
      hoursRetry: z.object({ attempted: z.boolean(), recovered: z.boolean(), costUsd: z.number().min(0).max(100) }),
      logo: z.object({
        status: z.enum(['ok', 'missing', 'failed']),
        reason: z.enum(LOGO_ISSUES).nullable(),
        kind: z.enum(LOGO_KINDS).nullable(),
        // Por qué falló la descarga (código HTTP, timeout…) o qué llegó en vez de una imagen.
        detail: z.string().max(100).nullable().optional(),
      }).default({ status: 'missing', reason: 'no_instagram', kind: null }),
      rateLimits: z.array(z.object({
        service: z.enum(['apify', 'exa', 'llm']),
        retries: z.number().int().min(0).max(100),
        waitedMs: z.number().min(0).max(3_600_000),
        recovered: z.boolean(),
        transientRetries: z.number().int().min(0).max(100).optional(),
      })).max(3).default([]),
      instagramFallback: z.object({
        attempted: z.boolean(),
        skipped: z.enum(['unconfirmed_name']).optional(),
        reason: z.string().max(1000).default(''),
        terms: z.array(z.string().max(200)).max(6).default([]),
        handles: z.array(z.string().max(60)).max(10),
        costUsd: z.number().min(0).max(100),
        tieBreak: z.enum(TIE_BREAK_RULES).optional(),
      }).optional(),
      instagramTieBreak: z.object({
        rule: z.enum(TIE_BREAK_RULES),
        pass: z.enum(['first', 'fallback']),
        handles: z.array(z.string().max(60)).max(10),
      }).optional(),
      instagramShared: z.array(z.object({ handle: z.string().max(60), places: z.array(z.string().max(300)).max(50) })).max(10).optional(),
    }).nullable(),
    reviewReasons: z.array(z.enum(REVIEW_REASON_IDS)).max(REVIEW_REASON_IDS.length).default([]),
  })).max(MAX_REPORT_PLACES),
  /** googlePlaceId de los lugares que no se procesaron por un error de Apify (sin nombre: el de Google no se guarda). */
  apifyErrors: z.array(z.string().trim().min(1).max(300)).max(MAX_REPORT_PLACES).default([]),
  /** El lote se cortó por errores de Apify seguidos. */
  stoppedByApify: z.boolean().default(false),
  /** googlePlaceId de los lugares que no se procesaron por un error de Exa. */
  exaErrors: z.array(z.string().trim().min(1).max(300)).max(MAX_REPORT_PLACES).default([]),
  /** El lote se cortó por errores de Exa seguidos. */
  stoppedByExa: z.boolean().default(false),
})

type PlaceRef = { name: string; googlePlaceId: string }
type ReportItem = PlaceRef & ({ text: string; proposedTag?: string | null } | { detail: string })

export type ProposedTagGroup =
  | { proposedTag: string; existing: boolean; places: number; facts: number; examples: { name: string; text: string }[] }
  | { proposedTag: 'ignored'; facts: number }

export type ExtractionReport = {
  summary: {
    placesProcessed: number
    hours: Record<'exact' | 'partial' | 'vague' | 'none', number>
    hoursRecoveredBySecondSearch: number
    hoursSecondSearchAttempted: number
    hoursSecondSearchCostUsd: number
    withInstagram: number
    withWebsite: number
    avgTags: number
    totalCostUsd: number
    avgSecondsPerPlace: number
    /** Logos: cuántos se subieron, por clasificación y por motivo de falta o fallo. */
    logos: { ok: number; missing: number; failed: number; byKind: Partial<Record<string, number>>; byReason: Partial<Record<LogoIssue, number>> }
    /** Costo del lote por etapa; la suma es totalCostUsd. */
    cost: { sourcesUsd: number; mainLlmUsd: number; hoursSecondSearchUsd: number; logoUsd: number; totalUsd: number }
    /** Tokens de entrada del llamado principal; cachedShare es la parte leída del cache. */
    tokens: { input: number; cachedInput: number; cacheWrite: number; cachedShare: number }
    /**
     * 429: reintentos por servicio, lugares con algún 429 y cuántos quedaron sin una fuente por no recuperarse.
     * transientRetries: reintentos de Apify por timeout o error pasajero.
     */
    rateLimits: { retries: Partial<Record<'apify' | 'exa' | 'llm', number>>; transientRetries: number; places: number; notRecovered: number }
    /** Lugares que no se procesaron por un error de Apify (hay que reintentarlos) y si el lote se cortó por eso. */
    apifyErrors: { places: string[]; stopped: boolean }
    /** Lo mismo con Exa. */
    exaErrors: { places: string[]; stopped: boolean }
    /** Desempates de Instagram por regla. */
    instagramTieBreaks: Partial<Record<InstagramTieBreakRule, number>>
    /** Lugares que se guardan con status review y cuántos por motivo (un lugar puede tener varios). */
    review: { places: number; byReason: Partial<Record<ReviewReason, number>> }
  }
  byType: Partial<Record<'unmapped_fact' | 'llm_doubt' | 'logo_failed' | PlaceReviewAnomalyType, ReportItem[]>>
  unmappedFactsByProposedTag: ProposedTagGroup[]
}

const MAX_EXAMPLES = 3
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits

/** Junta las revisiones de cada lugar del lote; un tipo sin casos no aparece. */
export function buildExtractionReport({ places, apifyErrors = [], stoppedByApify = false, exaErrors = [], stoppedByExa = false }: ExtractionReportRequest): ExtractionReport {
  const byType: ExtractionReport['byType'] = {}
  const add = (type: keyof ExtractionReport['byType'], item: ReportItem) => { (byType[type] ??= []).push(item) }
  const groups = new Map<string, { places: Set<string>; facts: number; examples: { name: string; text: string }[] }>()
  let ignored = 0

  for (const { name, googlePlaceId, review } of places) {
    if (!review) continue
    for (const fact of review.unmappedFacts) {
      add('unmapped_fact', { name, googlePlaceId, text: fact.text, proposedTag: fact.proposedTag })
      if (!fact.proposedTag) {
        ignored += 1
        continue
      }
      const group = groups.get(fact.proposedTag) ?? { places: new Set<string>(), facts: 0, examples: [] }
      group.places.add(googlePlaceId)
      group.facts += 1
      if (group.examples.length < MAX_EXAMPLES) group.examples.push({ name, text: fact.text })
      groups.set(fact.proposedTag, group)
    }
    for (const doubt of review.doubts) add('llm_doubt', { name, googlePlaceId, text: doubt })
    for (const anomaly of review.anomalies) add(anomaly.type, { name, googlePlaceId, detail: anomaly.detail })
    // Un logo que faltó por no haber foto usable no es para revisar; uno que falló, sí.
    if (review.logo.status === 'failed' && review.logo.reason) add('logo_failed', { name, googlePlaceId, detail: review.logo.reason })
  }

  const unmappedFactsByProposedTag: ProposedTagGroup[] = [...groups]
    .map(([proposedTag, group]) => ({
      proposedTag,
      existing: groupOf(proposedTag) !== null,
      places: group.places.size,
      facts: group.facts,
      examples: group.examples,
    }))
    .sort((left, right) => right.places - left.places || right.facts - left.facts || left.proposedTag.localeCompare(right.proposedTag))
  if (ignored > 0) unmappedFactsByProposedTag.push({ proposedTag: 'ignored', facts: ignored })

  const count = (predicate: (place: ExtractionReportRequest['places'][number]) => boolean) => places.filter(predicate).length
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
  const average = (values: number[]) => values.length > 0 ? sum(values) / values.length : 0
  const retries = places.flatMap((place) => place.review ? [place.review.hoursRetry] : [])
  const logos = places.flatMap((place) => place.review ? [place.review.logo] : [])
  const rateLimits = places.map((place) => place.review?.rateLimits ?? []).filter((entries) => entries.length > 0)
  const tally = <K extends string>(keys: (K | null)[]) => keys.reduce<Partial<Record<K, number>>>((counts, key) => key ? { ...counts, [key]: (counts[key] ?? 0) + 1 } : counts, {})
  const total = (field: 'sourcesUsd' | 'mainLlmUsd' | 'hoursRetryUsd' | 'logoUsd' | 'costUsd') => round(sum(places.map((place) => place.stats[field])), 4)
  const tokens = (field: 'inputTokens' | 'cachedInputTokens' | 'cacheWriteTokens') => sum(places.map((place) => place.stats[field]))
  return {
    summary: {
      placesProcessed: places.length,
      hours: {
        exact: count((place) => place.stats.hoursStatus === 'exact'),
        partial: count((place) => place.stats.hoursStatus === 'partial'),
        vague: count((place) => place.stats.hoursStatus === 'vague'),
        none: count((place) => place.stats.hoursStatus === 'none'),
      },
      hoursRecoveredBySecondSearch: retries.filter((retry) => retry.recovered).length,
      hoursSecondSearchAttempted: retries.filter((retry) => retry.attempted).length,
      hoursSecondSearchCostUsd: round(sum(retries.map((retry) => retry.costUsd)), 4),
      withInstagram: count((place) => place.stats.hasInstagram),
      withWebsite: count((place) => place.stats.hasWebsite),
      avgTags: round(average(places.map((place) => place.stats.tagCount)), 1),
      totalCostUsd: round(sum(places.map((place) => place.stats.costUsd)), 4),
      avgSecondsPerPlace: round(average(places.map((place) => place.stats.totalMs)) / 1000, 1),
      logos: {
        ok: logos.filter((logo) => logo.status === 'ok').length,
        missing: logos.filter((logo) => logo.status === 'missing').length,
        failed: logos.filter((logo) => logo.status === 'failed').length,
        byKind: tally(logos.map((logo) => logo.kind)),
        byReason: tally(logos.map((logo) => logo.reason)),
      },
      cost: { sourcesUsd: total('sourcesUsd'), mainLlmUsd: total('mainLlmUsd'), hoursSecondSearchUsd: total('hoursRetryUsd'), logoUsd: total('logoUsd'), totalUsd: total('costUsd') },
      tokens: {
        input: tokens('inputTokens'),
        cachedInput: tokens('cachedInputTokens'),
        cacheWrite: tokens('cacheWriteTokens'),
        cachedShare: tokens('inputTokens') > 0 ? round(tokens('cachedInputTokens') / tokens('inputTokens'), 3) : 0,
      },
      rateLimits: {
        retries: rateLimits.flat().reduce<Partial<Record<'apify' | 'exa' | 'llm', number>>>((counts, entry) => ({ ...counts, [entry.service]: (counts[entry.service] ?? 0) + entry.retries }), {}),
        transientRetries: sum(rateLimits.flat().map((entry) => entry.transientRetries ?? 0)),
        places: rateLimits.length,
        notRecovered: rateLimits.filter((entries) => entries.some((entry) => !entry.recovered)).length,
      },
      apifyErrors: { places: apifyErrors, stopped: stoppedByApify },
      exaErrors: { places: exaErrors, stopped: stoppedByExa },
      instagramTieBreaks: tally(places.map((place) => place.review?.instagramTieBreak?.rule ?? null)),
      review: {
        places: count((place) => (place.reviewReasons ?? []).length > 0),
        byReason: tally(places.flatMap((place) => place.reviewReasons ?? [])),
      },
    },
    byType,
    unmappedFactsByProposedTag,
  }
}

export function reportSummary(report: ExtractionReport): string {
  const { summary } = report
  const counts = Object.entries(report.byType).map(([type, items]) => `${type}: ${items.length}`)
  return [
    `${summary.placesProcessed} lugares · ${counts.length > 0 ? counts.join(' · ') : 'sin casos'}`,
    `Horarios recuperados con la segunda búsqueda: ${summary.hoursRecoveredBySecondSearch} de ${summary.hoursSecondSearchAttempted} (USD ${summary.hoursSecondSearchCostUsd.toFixed(4)})`,
    `A revisar: ${summary.review.places}${summary.review.places > 0 ? ` (${Object.entries(summary.review.byReason).map(([reason, count]) => `${reason} ${count}`).join(' · ')})` : ''}`,
    `Logos: ${summary.logos.ok} subidos · ${summary.logos.missing} sin foto usable · ${summary.logos.failed} con fallas`,
    `Costo USD ${summary.cost.totalUsd.toFixed(4)}: fuentes ${summary.cost.sourcesUsd.toFixed(4)} · LLM principal ${summary.cost.mainLlmUsd.toFixed(4)} · segunda búsqueda ${summary.cost.hoursSecondSearchUsd.toFixed(4)} · logo ${summary.cost.logoUsd.toFixed(4)}`,
    `Tokens cacheados: ${summary.tokens.cachedInput} de ${summary.tokens.input} (${Math.round(summary.tokens.cachedShare * 100)}%) · escritos en cache: ${summary.tokens.cacheWrite}`,
    ...(summary.rateLimits.places > 0
      ? [`Límite de consultas (429): ${Object.entries(summary.rateLimits.retries).map(([service, retries]) => `${service} ${retries} reintentos`).join(' · ')} · ${summary.rateLimits.places} lugares · ${summary.rateLimits.notRecovered} sin recuperar`]
      : []),
    ...(summary.rateLimits.transientRetries > 0 ? [`Reintentos de Apify por timeout o error: ${summary.rateLimits.transientRetries}`] : []),
    ...(summary.apifyErrors.places.length > 0
      ? [`Error de Apify: ${summary.apifyErrors.places.length} sin procesar${summary.apifyErrors.stopped ? ' · el lote se cortó' : ''}`]
      : []),
    ...(summary.exaErrors.places.length > 0
      ? [`Error de Exa: reintentar · ${summary.exaErrors.places.length} sin procesar${summary.exaErrors.stopped ? ' · el lote se cortó' : ''}`]
      : []),
  ].join('\n')
}

function timestamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

export type ExtractionReportWriter = (report: ExtractionReport) => Promise<string>

/** Escribe output/report-<fecha-hora>.json y devuelve la ruta. */
export function fileReportWriter(dir = 'output'): ExtractionReportWriter {
  return async (report) => {
    await mkdir(dir, { recursive: true })
    const path = join(dir, `report-${timestamp(new Date())}.json`)
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`)
    return path
  }
}
