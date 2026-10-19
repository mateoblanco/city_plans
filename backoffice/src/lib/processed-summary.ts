import type { ExtractionRow } from '@/hooks/use-extraction-batch'
import { REVIEW_REASONS, type ReviewReason } from '@/data/review-reasons'

export type ProcessedSummary = {
  procesados: number
  conError: number
  anomalias: Record<string, number>
  dudas: { lugar: string; dudas: string[] }[]
  /** Lugares que se guardan con status review, por motivo (label en español). */
  aRevisar: Record<string, string[]>
}

/** Resumen del lote para copiar: conteos, anomalías de review por tipo, dudas por lugar y lugares a revisar por motivo. */
export function buildProcessedSummary(
  processed: readonly [string, ExtractionRow][],
  nameOf: (id: string, row: ExtractionRow) => string,
): ProcessedSummary {
  const counts = new Map<string, number>()
  const dudas: ProcessedSummary['dudas'] = []
  const aRevisar = new Map<ReviewReason, string[]>()
  for (const [id, row] of processed) {
    if (row.status !== 'done' || row.result?.status !== 'ok') continue
    for (const anomaly of row.result.review.anomalies) counts.set(anomaly.type, (counts.get(anomaly.type) ?? 0) + 1)
    if (row.result.review.doubts.length > 0) dudas.push({ lugar: nameOf(id, row), dudas: row.result.review.doubts })
    for (const reason of row.result.place.reviewReasons ?? []) aRevisar.set(reason, [...(aRevisar.get(reason) ?? []), nameOf(id, row)])
  }
  return {
    procesados: processed.length,
    conError: processed.filter(([, row]) => row.status === 'error').length,
    anomalias: Object.fromEntries([...counts].sort((a, b) => b[1] - a[1])),
    dudas,
    aRevisar: Object.fromEntries([...aRevisar].map(([reason, names]) => [REVIEW_REASONS[reason], names])),
  }
}
