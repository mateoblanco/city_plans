// Recalcula chain_branch de los lugares guardados con la regla del pipeline, sin Exa, Apify ni LLM: es cadena si
// comparte brand_key con otro lugar o una fuente oficial del snapshot (la web o el Instagram guardados) muestra varias
// sucursales. Marca y desmarca. Por defecto no escribe: lista cada lugar que cambia con la evidencia y su prominence
// antes → después. Sin snapshot ni brand_key compartida, o con chain_branch puesto a mano, no lo toca.
// --write escribe sólo chain_branch y prominence, sin tocar updatedAt.
// Uso: yarn chains:backfill [--write]
import './env.ts'
import { eq } from 'drizzle-orm'
import { places } from '../db/schema.ts'
import { recomputeChains } from '../places/refresh-signals.ts'
import { drizzleIgMedian } from '../places/list.ts'
import { readSnapshots } from '../providers/extraction-snapshots.ts'
import { parseManualOverrides } from '../../src/data/manual-overrides.ts'
import { neighborhoodDisplayName } from '../../src/data/neighborhood-names.ts'

async function main() {
  const write = process.argv.includes('--write')
  if (!process.env.DATABASE_URL) throw new Error('Falta configurar DATABASE_URL en .env.local.')
  const { db } = await import('../db/index.ts')
  const rows = (await db.select({
    id: places.id, googlePlaceId: places.googlePlaceId, name: places.name, neighborhoodId: places.neighborhoodId, instagram: places.instagram,
    website: places.website, brandKey: places.brandKey, igFollowers: places.igFollowers, chainBranch: places.chainBranch, prominence: places.prominence,
    manualOverrides: places.manualOverrides,
  }).from(places)).map((row) => ({ ...row, manualOverrides: parseManualOverrides(row.manualOverrides) }))

  const changes = recomputeChains(rows, await readSnapshots(), await drizzleIgMedian(db))
    .sort((a, b) => Number(a.after.chainBranch) - Number(b.after.chainBranch) || a.name.localeCompare(b.name))
  const neighborhood = new Map(rows.map((row) => [row.id, neighborhoodDisplayName(row.neighborhoodId) ?? row.neighborhoodId]))
  for (const change of changes) {
    const followers = change.before.igFollowers === null ? 'sin seguidores' : `${change.before.igFollowers} seg`
    const direction = change.after.chainBranch ? 'false → true ' : 'true → false '
    console.log(`${direction} ${change.name} (${neighborhood.get(change.id)}) · ${followers} · prominence ${change.before.prominence.toFixed(3)} → ${change.after.prominence.toFixed(3)}`)
    for (const evidence of change.evidence) console.log(`              ${evidence}`)
  }
  const marked = changes.filter((change) => change.after.chainBranch).length
  const manual = rows.filter((row) => Object.hasOwn(row.manualOverrides, 'chain_branch')).length
  console.log(`\n${marked} pasan a cadena, ${changes.length - marked} dejan de serlo, ${rows.length - changes.length} sin cambio (${manual} a mano).`)
  if (!write) {
    console.log('Sin escribir: --write escribe chain_branch y prominence.')
    return
  }
  for (const change of changes) {
    await db.update(places).set({ chainBranch: change.after.chainBranch, prominence: change.after.prominence, updatedAt: places.updatedAt }).where(eq(places.id, change.id))
  }
  console.log(`Escritos: ${changes.length}.`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
