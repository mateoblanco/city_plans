// Marca chain_branch en los lugares que comparten brand_key con otro (sucursales de una marca), sin Exa, Apify ni LLM:
// sólo con lo guardado. Por defecto no escribe: lista cada lugar que pasa a cadena con su prominence antes → después.
// --write escribe sólo chain_branch y prominence, sin tocar updatedAt. No desmarca: una marca con un solo lugar
// guardado queda como estaba.
// Uso: yarn chains:backfill [--write]
import './env.ts'
import { eq } from 'drizzle-orm'
import { places } from '../db/schema.ts'
import { sharedBrandKeys } from '../places/brand-key.ts'
import { computeProminence } from '../places/prominence.ts'
import { applyOverrides } from '../places/manual-overrides.ts'
import { parseManualOverrides } from '../../src/data/manual-overrides.ts'
import { neighborhoodDisplayName } from '../../src/data/neighborhood-names.ts'

async function main() {
  const write = process.argv.includes('--write')
  if (!process.env.DATABASE_URL) throw new Error('Falta configurar DATABASE_URL en .env.local.')
  const { db } = await import('../db/index.ts')
  const rows = await db.select({
    id: places.id, name: places.name, neighborhoodId: places.neighborhoodId, brandKey: places.brandKey, igFollowers: places.igFollowers,
    chainBranch: places.chainBranch, prominence: places.prominence, manualOverrides: places.manualOverrides,
  }).from(places)

  const shared = sharedBrandKeys(rows)
  const changes = rows.filter((row) => shared.has(row.id) && !row.chainBranch)
    .map((row) => ({ row, prominence: computeProminence({ igFollowers: row.igFollowers, chainBranch: true }) }))
    .sort((a, b) => a.row.brandKey!.localeCompare(b.row.brandKey!) || a.row.name.localeCompare(b.row.name))

  for (const { row, prominence } of changes) {
    const followers = row.igFollowers === null ? 'sin seguidores' : `${row.igFollowers} seg`
    console.log(`${row.brandKey} · ${row.name} (${neighborhoodDisplayName(row.neighborhoodId) ?? row.neighborhoodId}) · ${followers} · prominence ${row.prominence.toFixed(3)} → ${prominence.toFixed(3)}`)
  }
  const already = rows.filter((row) => shared.has(row.id) && row.chainBranch).length
  console.log(`\n${changes.length} pasan a cadena; ${already} con brand_key compartida ya eran cadena.`)
  if (!write) {
    console.log('Sin escribir: --write escribe chain_branch y prominence.')
    return
  }
  for (const { row, prominence } of changes) {
    await db.update(places)
      .set({ ...applyOverrides({ chainBranch: true, prominence }, parseManualOverrides(row.manualOverrides)), updatedAt: places.updatedAt })
      .where(eq(places.id, row.id))
  }
  console.log(`Escritos: ${changes.length}.`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
