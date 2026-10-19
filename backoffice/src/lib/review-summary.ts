import type { ExtractionRow } from '@/hooks/use-extraction-batch'
import { CLOSED_REASONS, REVIEW_REASONS, isClosedReason, type ClosedReason, type ReviewReason } from '@/data/review-reasons'
import type { NeighborhoodSweepPlace } from '@/types/places'

export type ReviewSummary = {
  /** Lugares procesados que se van a guardar con status review, por motivo (un lugar puede estar en varios). */
  byReason: Record<ReviewReason, string[]>
  /** Cuántos lugares procesados tienen algún motivo. */
  places: number
}

export type ClosedSummary = Record<ClosedReason, string[]>

const MISSING_NAME = 'Sin nombre confirmado'

/** Motivos de revisión de cada lugar procesado, con los nombres. */
export function reviewSummary(rows: readonly ExtractionRow[]): ReviewSummary {
  const byReason = Object.fromEntries(Object.keys(REVIEW_REASONS).map((id) => [id, []])) as unknown as ReviewSummary['byReason']
  let places = 0
  for (const row of rows) {
    if (row.status !== 'done' || row.result?.status !== 'ok') continue
    const reasons = row.result.place.reviewReasons ?? []
    if (reasons.length === 0) continue
    places += 1
    for (const reason of reasons) byReason[reason]?.push(row.result.place.name || MISSING_NAME)
  }
  return { byReason, places }
}

/** Cerrados según Google detectados en el barrido (dentro del barrio), por estado. */
export function closedSummary(places: readonly NeighborhoodSweepPlace[]): ClosedSummary {
  const closed = Object.fromEntries(Object.keys(CLOSED_REASONS).map((id) => [id, []])) as unknown as ClosedSummary
  for (const place of places) {
    if (place.insideNeighborhood !== false && isClosedReason(place.reason)) closed[place.reason].push(place.name)
  }
  return closed
}
