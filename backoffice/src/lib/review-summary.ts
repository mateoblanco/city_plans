import type { ExtractionRow } from '@/hooks/use-extraction-batch'
import { REVIEW_REASONS, type ReviewReason } from '@/data/review-reasons'
import type { NeighborhoodSweepPlace } from '@/types/places'

export type ReviewSummary = {
  /** Lugares procesados que se van a guardar con status review, por motivo (un lugar puede estar en varios). */
  byReason: Record<ReviewReason, string[]>
  /** Cuántos lugares procesados tienen algún motivo. */
  places: number
}

/** Los temporales se procesan y salen por motivo en ReviewSummary: acá sólo los definitivos, que no se procesan. */
export type ClosedSummary = { closed_permanently: string[] }

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

/** Cerrados definitivamente según Google detectados en el barrido (dentro del barrio). */
export function closedSummary(places: readonly NeighborhoodSweepPlace[]): ClosedSummary {
  const names = places.filter((place) => place.insideNeighborhood !== false && place.reason === 'closed_permanently').map((place) => place.name)
  return { closed_permanently: names }
}
