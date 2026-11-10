import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_EXTRACTION_USD, searchEstimate } from './search-estimate.ts'

const report = (totalCostUsd: number, placesProcessed: number) => JSON.stringify({ summary: { totalCostUsd, placesProcessed } })

describe('searchEstimate', () => {
  it('promedio real de los últimos 10 reportes; uno roto se saltea', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reports-'))
    // El más viejo queda afuera (11 reportes).
    await writeFile(join(dir, 'report-2026-01-01_00-00-00.json'), report(100, 1))
    for (let day = 10; day < 20; day++) await writeFile(join(dir, `report-2026-10-${day}_00-00-00.json`), report(0.8, 10))
    await writeFile(join(dir, 'report-2026-10-20_00-00-00.json'), '{roto')
    await writeFile(join(dir, 'otro.json'), report(100, 1))
    expect(await searchEstimate(dir)).toEqual({ searchUsd: 0.032, extractionUsd: 0.08, basedOnPlaces: 90, basedOnReports: 9 })
  })

  it('sin reportes: el valor por defecto', async () => {
    expect(await searchEstimate(join(tmpdir(), 'no-existe-reports'))).toEqual({ searchUsd: 0.032, extractionUsd: DEFAULT_EXTRACTION_USD, basedOnPlaces: 0, basedOnReports: 0 })
  })
})
