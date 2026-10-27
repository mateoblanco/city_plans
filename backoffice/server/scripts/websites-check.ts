// Revisa las webs guardadas con la regla del pipeline (websiteRejection), sin Exa, Apify ni LLM: WhatsApp, agregadores de
// links, redes, reservas, pedidos, directorios y webs de otro país (dominio, o precios, teléfonos o direcciones de otro
// país en el texto del snapshot, salvo que mencione Montevideo o Uruguay). Una web editada a mano no se toca.
// Por defecto no escribe: lista las que se descartan, con el motivo y chain_branch antes → después, y aparte las dudosas.
// --write pone website = null en las descartadas (y en las dudosas de --drop) y chain_branch y prominence si cambian, sin
// tocar updatedAt. Después: yarn chains:backfill y yarn brands:backfill.
// Uso: yarn websites:check [--write] [--drop <id>,…]
import './env.ts'
import { eq } from 'drizzle-orm'
import { places } from '../db/schema.ts'
import { checkSavedWebsites, type WebsiteVerdict } from '../places/website-backfill.ts'
import { drizzleIgMedian } from '../places/list.ts'
import { readSnapshots } from '../providers/extraction-snapshots.ts'
import { parseManualOverrides } from '../../src/data/manual-overrides.ts'
import { neighborhoodDisplayName } from '../../src/data/neighborhood-names.ts'

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

function print(verdict: WebsiteVerdict) {
  console.log(`  ${verdict.name} (${neighborhoodDisplayName(verdict.neighborhoodId) ?? verdict.neighborhoodId}) · ${verdict.id}`)
  console.log(`    ${verdict.website} — ${verdict.reason}`)
  const chain = verdict.chain
  console.log(chain
    ? `    chain_branch ${chain.before.chainBranch} → ${chain.after.chainBranch} · prominence ${chain.before.prominence.toFixed(3)} → ${chain.after.prominence.toFixed(3)}`
    : '    chain_branch sin cambio')
}

async function main() {
  const write = process.argv.includes('--write')
  const drop = new Set((argValue('--drop') ?? '').split(',').map((id) => id.trim()).filter(Boolean))
  if (!process.env.DATABASE_URL) throw new Error('Falta configurar DATABASE_URL en .env.local.')
  const { db } = await import('../db/index.ts')
  const rows = (await db.select({
    id: places.id, googlePlaceId: places.googlePlaceId, name: places.name, neighborhoodId: places.neighborhoodId, instagram: places.instagram,
    website: places.website, brandKey: places.brandKey, igFollowers: places.igFollowers, chainBranch: places.chainBranch, prominence: places.prominence,
    manualOverrides: places.manualOverrides,
  }).from(places)).map((row) => ({ ...row, manualOverrides: parseManualOverrides(row.manualOverrides) }))

  const verdicts = checkSavedWebsites(rows, await readSnapshots(), await drizzleIgMedian(db))
  const dropped = verdicts.filter((verdict) => verdict.kind === 'drop')
  const doubtful = verdicts.filter((verdict) => verdict.kind === 'doubtful')
  const unknown = [...drop].filter((id) => !doubtful.some((verdict) => verdict.id === id))
  if (unknown.length) throw new Error(`--drop sólo acepta ids de la lista de dudosos: ${unknown.join(', ')}`)

  console.log(`Se descartan (${dropped.length}):`)
  for (const verdict of dropped) print(verdict)
  console.log(`\nDudosos, para decidir a mano (${doubtful.length}); se descartan con --drop <id>,…:`)
  for (const verdict of doubtful) print(verdict)
  const withWebsite = rows.filter((row) => row.website).length
  const manual = rows.filter((row) => row.website && Object.hasOwn(row.manualOverrides, 'website')).length
  console.log(`\n${withWebsite} lugares con web: ${dropped.length} se descartan, ${doubtful.length} dudosos, ${manual} editadas a mano (no se tocan). Sin llamadas pagas.`)

  const targets = [...dropped, ...doubtful.filter((verdict) => drop.has(verdict.id))]
  if (!write) {
    console.log('Sin escribir: --write pone la web en null en las descartadas (y en las de --drop).')
    return
  }
  for (const verdict of targets) {
    const chain = verdict.chain ? { chainBranch: verdict.chain.after.chainBranch, prominence: verdict.chain.after.prominence } : {}
    await db.update(places).set({ website: null, ...chain, updatedAt: places.updatedAt }).where(eq(places.id, verdict.id))
  }
  console.log(`Escritos: ${targets.length}. Ahora: yarn chains:backfill y yarn brands:backfill.`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
