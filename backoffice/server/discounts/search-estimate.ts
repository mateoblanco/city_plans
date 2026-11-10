import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PlaceSearchEstimate } from '../../src/types/discounts.ts'
import { FIND_PLACE_USD } from '../providers/google-places-provider.ts'

/** Sin reportes: el promedio de los últimos lotes al escribir esto (214 lugares, octubre de 2026). */
export const DEFAULT_EXTRACTION_USD = 0.075
const RECENT_REPORTS = 10

/**
 * Costo por lugar para el diálogo de "Buscar seleccionados": la búsqueda (Text Search Pro) y la extracción promedio de
 * los últimos reportes de lote (output/report-*.json: totalCostUsd / placesProcessed). Un reporte ilegible se saltea.
 */
export async function searchEstimate(dir = 'output'): Promise<PlaceSearchEstimate> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => /^report-.*\.json$/.test(name)).sort().slice(-RECENT_REPORTS)
  let cost = 0
  let places = 0
  let reports = 0
  for (const name of names) {
    try {
      const summary = (JSON.parse(await readFile(join(dir, name), 'utf8')) as { summary?: { totalCostUsd?: unknown; placesProcessed?: unknown } }).summary
      const total = Number(summary?.totalCostUsd)
      const count = Number(summary?.placesProcessed)
      if (!Number.isFinite(total) || !Number.isInteger(count) || count <= 0) continue
      cost += total
      places += count
      reports += 1
    } catch {
      // Un reporte roto no cambia el promedio.
    }
  }
  return {
    searchUsd: FIND_PLACE_USD,
    extractionUsd: places > 0 ? Math.round((cost / places) * 10_000) / 10_000 : DEFAULT_EXTRACTION_USD,
    basedOnPlaces: places,
    basedOnReports: reports,
  }
}
