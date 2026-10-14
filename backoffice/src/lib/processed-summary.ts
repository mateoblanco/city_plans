import type { ExtractionRow } from '@/hooks/use-extraction-batch'

export type ProcessedSummary = {
  procesados: number
  conError: number
  anomalias: Record<string, number>
  dudas: { lugar: string; dudas: string[] }[]
}

/** Resumen del lote para copiar: conteos, anomalías de review por tipo y dudas por lugar. */
export function buildProcessedSummary(
  processed: readonly [string, ExtractionRow][],
  nameOf: (id: string, row: ExtractionRow) => string,
): ProcessedSummary {
  const counts = new Map<string, number>()
  const dudas: ProcessedSummary['dudas'] = []
  for (const [id, row] of processed) {
    if (row.status !== 'done' || row.result?.status !== 'ok') continue
    for (const anomaly of row.result.review.anomalies) counts.set(anomaly.type, (counts.get(anomaly.type) ?? 0) + 1)
    if (row.result.review.doubts.length > 0) dudas.push({ lugar: nameOf(id, row), dudas: row.result.review.doubts })
  }
  return {
    procesados: processed.length,
    conError: processed.filter(([, row]) => row.status === 'error').length,
    anomalias: Object.fromEntries([...counts].sort((a, b) => b[1] - a[1])),
    dudas,
  }
}
