// Recalcula prominence de todos los lugares desde los seguidores guardados, sin buscar nada nuevo. Para cuando cambia
// la fórmula de computeProminence o la mediana de los publicados (lo que vale un lugar sin seguidores) se movió.
// Por defecto no escribe: lista cada lugar que cambia, antes → después. --write escribe sólo prominence, sin updatedAt.
// Uso: yarn prominence:recompute [--write]
import './env.ts'
import { eq } from 'drizzle-orm'
import { places } from '../db/schema.ts'
import { computeProminence, medianIgTerm } from '../places/prominence.ts'
import { applyOverrides } from '../places/manual-overrides.ts'
import { parseManualOverrides } from '../../src/data/manual-overrides.ts'

async function main() {
  const write = process.argv.includes('--write')
  if (!process.env.DATABASE_URL) throw new Error('Falta configurar DATABASE_URL en .env.local.')
  const { db } = await import('../db/index.ts')
  const rows = await db
    .select({
      id: places.id, name: places.name, status: places.status, igFollowers: places.igFollowers, chainBranch: places.chainBranch,
      prominence: places.prominence, manualOverrides: places.manualOverrides,
    })
    .from(places)
  // La misma mediana que drizzleIgMedian, con los rows ya cargados.
  const igMedian = medianIgTerm(rows.filter((row) => row.status === 'published').map((row) => row.igFollowers))
  console.log(`Mediana del término de Instagram (publicados con seguidores): ${igMedian.toFixed(4)}\n`)
  const changes = rows.flatMap((row) => {
    const { prominence } = applyOverrides({ prominence: computeProminence(row, igMedian) }, parseManualOverrides(row.manualOverrides))
    return Math.abs(prominence - row.prominence) < 1e-6 ? [] : [{ ...row, after: prominence }]
  }).sort((a, b) => a.name.localeCompare(b.name))
  for (const change of changes) {
    const followers = change.igFollowers === null ? 'sin seguidores' : `${change.igFollowers} seg`
    console.log(`${change.name}${change.chainBranch ? ' (cadena)' : ''} · ${followers} · ${change.prominence.toFixed(3)} → ${change.after.toFixed(3)}`)
  }
  console.log(`\n${changes.length} de ${rows.length} lugares cambian.`)
  if (!write) {
    console.log('Sin escribir: --write escribe prominence.')
    return
  }
  // Sólo prominence: no es una actualización del contenido, así que updatedAt no cambia.
  for (const change of changes) {
    await db.update(places).set({ prominence: change.after, updatedAt: places.updatedAt }).where(eq(places.id, change.id))
  }
  console.log(`Escritos: ${changes.length}.`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
