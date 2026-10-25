// Recalcula prominence de todos los lugares desde los seguidores guardados, sin buscar nada nuevo.
// Para cuando cambia la fórmula de computeProminence. Uso: yarn prominence:recompute
import './env.ts'
import { eq } from 'drizzle-orm'
import { places } from '../db/schema.ts'
import { computeProminence } from '../places/prominence.ts'
import { applyOverrides } from '../places/manual-overrides.ts'
import { parseManualOverrides } from '../../src/data/manual-overrides.ts'

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Falta configurar DATABASE_URL en .env.local.')
  const { db } = await import('../db/index.ts')
  const rows = await db
    .select({ id: places.id, igFollowers: places.igFollowers, chainBranch: places.chainBranch, prominence: places.prominence, manualOverrides: places.manualOverrides })
    .from(places)
  let changed = 0
  for (const row of rows) {
    const prominence = computeProminence(row)
    if (Math.abs(prominence - row.prominence) < 1e-6) continue
    // Sólo prominence: no es una actualización del contenido, así que updatedAt no cambia.
    await db.update(places).set({ ...applyOverrides({ prominence }, parseManualOverrides(row.manualOverrides)), updatedAt: places.updatedAt }).where(eq(places.id, row.id))
    changed += 1
  }
  console.log(`prominence recalculado: ${changed} de ${rows.length} lugares cambiaron.`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
