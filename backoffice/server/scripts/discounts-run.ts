// Corre los lectores de descuentos desde la terminal (lo mismo que "Actualizar descuentos") y guarda en la base.
// --from <runId> (o --from latest): reprocesa el HTML crudo guardado en cache/discounts/raw/<runId>, sin bajar nada
// (0 pedidos); el modelo, si hace falta, sale del cache por texto. Así se llena la base después de migrar.
// --only <id>,…: sólo esos proveedores. --dry-run: no escribe en la base (lee nuestros lugares sólo para el cruce y guarda
// en memoria): para ver qué pasaría.
// Uso: yarn discounts:run [--from <runId>|latest] [--only santander] [--dry-run]   ·   yarn discounts:reparse (= --from latest)
import './env.ts'
import type { DiscountPlace, DiscountRun } from '../../src/types/discounts.ts'
import { drizzleDiscountStore } from '../discounts/drizzle-store.ts'
import { memoryDiscountStore } from '../discounts/memory-store.ts'
import { runDiscounts } from '../discounts/run.ts'
import { discountRunDependencies } from '../discounts/setup.ts'
import { DISCOUNT_PROVIDERS } from '../discounts/providers.ts'

function summary(run: DiscountRun, places: DiscountPlace[]) {
  console.log(`Corrida ${run.id}${run.reparsedFrom ? ` (desde el HTML de ${run.reparsedFrom})` : ''}`)
  for (const provider of run.providers) {
    console.log(`  ${provider.name}: ${provider.status}, ${provider.places} lugares, ${provider.requests} pedidos, modelo ${provider.llm.calls} llamadas US$ ${provider.llm.costUsd.toFixed(4)}${provider.error ? ` — ${provider.error}` : ''}`)
    for (const note of provider.notes ?? []) console.log(`    nota: ${note}`)
  }
  const active = places.filter((place) => place.active)
  const counts = { found: 0, doubtful: 0, missing: 0, not_matched: 0 }
  for (const place of active) counts[place.match.status] += 1
  const benefits = active.flatMap((place) => place.benefits)
  console.log(`  En la base: ${places.length} lugares (${active.length} activos, ${places.filter((place) => place.ignored).length} ignorados), ${benefits.filter((benefit) => benefit.active && !benefit.expired).length} beneficios vigentes`)
  console.log(`  Cruce (activos): ${counts.found} encontrados, ${counts.doubtful} dudosos, ${counts.missing} no están en la base, ${counts.not_matched} fuera de Montevideo · ${active.filter((place) => place.match.origin === 'manual').length} manuales`)
  for (const error of run.errors) console.log(`  ERROR ${error.url}: ${error.message}`)
  for (const warning of run.warnings) console.log(`  aviso: ${warning}`)
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} necesita un valor.`)
  return value
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Falta configurar DATABASE_URL en .env.local: el cruce lee nuestros lugares de la base.')
  const fromRun = flag('--from')
  const only = flag('--only')?.split(',').map((id) => id.trim()).filter(Boolean)
  const unknown = only?.filter((id) => !DISCOUNT_PROVIDERS.some((provider) => provider.id === id)) ?? []
  if (unknown.length) throw new Error(`Proveedores desconocidos: ${unknown.join(', ')}.`)
  const dryRun = process.argv.includes('--dry-run')
  const [{ db }, { drizzleDiscountCandidates }] = await Promise.all([import('../db/index.ts'), import('../places/list.ts')])
  const candidates = drizzleDiscountCandidates(db)
  // En seco: todo en memoria, empezando vacío (como una base recién migrada).
  const store = dryRun ? memoryDiscountStore(await candidates()) : drizzleDiscountStore(db)
  const run = await runDiscounts(discountRunDependencies({ store, candidates, fromRun, only }), { reparsedFrom: fromRun })
  if (dryRun) console.log('En seco: no se escribió nada en la base.')
  summary(run, await store.list())
  if (run.providers.every((provider) => provider.status === 'error')) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
