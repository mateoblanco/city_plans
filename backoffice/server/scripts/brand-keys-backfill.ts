// Calcula brand_key de todos los lugares guardados sólo con lo que ya está en la base (Instagram, chain_branch y el
// nombre): sin Exa, Apify ni LLM. Por defecto no escribe: lista cada marca con sus lugares, los avisos y los cambios.
// --write escribe sólo brand_key, sin tocar updatedAt. brand_key no entra en los textos de búsqueda. Un brand_key editado
// a mano (manual_overrides) no cambia, y las sucursales con su mismo Instagram toman esa key.
// Uso: yarn brands:backfill [--write]
import './env.ts'
import { eq, sql } from 'drizzle-orm'
import { places } from '../db/schema.ts'
import { assignBrandKeys, type BrandRow } from '../places/brand-key.ts'
import { neighborhoodDisplayName } from '../../src/data/neighborhood-names.ts'

async function main() {
  const write = process.argv.includes('--write')
  if (!process.env.DATABASE_URL) throw new Error('Falta configurar DATABASE_URL en .env.local.')
  const { db } = await import('../db/index.ts')

  // Antes de la migración la columna no existe: el dry-run igual funciona, con todo en null.
  const { rows: columns } = await db.execute(sql`select 1 from information_schema.columns where table_name = 'places' and column_name = 'brand_key'`)
  const hasColumn = columns.length > 0
  if (write && !hasColumn) throw new Error('Falta la columna brand_key: corré yarn db:migrate antes de --write.')
  const base = {
    id: places.id, name: places.name, neighborhoodId: places.neighborhoodId, instagram: places.instagram, chainBranch: places.chainBranch, status: places.status,
    locked: sql<boolean>`${places.manualOverrides} ? 'brand_key'`,
  }
  const rows: (BrandRow & { status: string })[] = hasColumn
    ? await db.select({ ...base, brandKey: places.brandKey }).from(places)
    : (await db.select(base).from(places)).map((row) => ({ ...row, brandKey: null }))

  // Sin las keys guardadas: el backfill recalcula desde cero (las guardadas sólo sirven para reusar en save.ts), salvo
  // las editadas a mano.
  const { keys, warnings } = assignBrandKeys(rows.map((row) => ({ ...row, brandKey: row.locked ? row.brandKey ?? null : null })))
  const byKey = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = keys.get(row.id)
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), row])
  }
  for (const [key, group] of [...byKey].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
    console.log(`${key} (${group.length})`)
    for (const row of group) {
      const extras = [row.instagram ? `@${row.instagram.replace(/^@/, '')}` : 'sin Instagram', row.chainBranch ? 'cadena' : null, row.status !== 'published' ? row.status : null]
      console.log(`  ${row.name} · ${neighborhoodDisplayName(row.neighborhoodId) ?? row.neighborhoodId} (${[...extras, row.locked ? 'editada a mano' : null].filter(Boolean).join(', ')})`)
    }
  }
  if (warnings.length) {
    console.log('\nAvisos:')
    for (const warning of warnings) console.log(`  ${warning}`)
  }

  const changes = rows.filter((row) => (row.brandKey ?? null) !== keys.get(row.id))
  const grouped = [...byKey.values()].filter((group) => group.length > 1)
  console.log(`\n${rows.length} lugares: ${byKey.size} marcas (${grouped.length} con más de un lugar, ${grouped.reduce((sum, group) => sum + group.length, 0)} lugares), ${changes.length} ${write ? 'actualizados' : 'cambiarían'}. Sin llamadas pagas.`)
  for (const row of changes) console.log(`  ${row.name}: ${row.brandKey ?? '—'} → ${keys.get(row.id) ?? '—'}`)
  if (!write) {
    console.log('\nDry-run: no se escribió nada. Con --write se guarda.')
    return
  }
  for (const row of changes) {
    await db.update(places).set({ brandKey: keys.get(row.id) ?? null, updatedAt: places.updatedAt }).where(eq(places.id, row.id))
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
