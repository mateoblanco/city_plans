// Corre los lectores de descuentos desde la terminal (lo mismo que "Actualizar descuentos") y guarda en la base.
// --from <runId> (o --from latest): reprocesa el HTML crudo guardado en cache/discounts/raw/<runId>, sin bajar nada
// (0 pedidos); el modelo, si hace falta, sale del cache por texto. Así se llena la base después de migrar.
// --only <id>,…: sólo esos proveedores. --dry-run: no escribe en la base (lee lo guardado y nuestros lugares, y escribe en
// memoria sobre una copia): para ver qué pasaría, con el antes → después de cada proveedor.
// Uso: yarn discounts:run [--from <runId>|latest] [--only santander] [--dry-run]   ·   yarn discounts:reparse (= --from latest)
import './env.ts'
import type { DiscountPlace, DiscountRun } from '../../src/types/discounts.ts'
import { drizzleDiscountStore } from '../discounts/drizzle-store.ts'
import { memoryDiscountStore } from '../discounts/memory-store.ts'
import { runDiscounts } from '../discounts/run.ts'
import { discountRunDependencies } from '../discounts/setup.ts'
import { DISCOUNT_PROVIDER_IDS } from '../discounts/providers.ts'

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
  console.log(`  En la base: ${places.length} lugares (${active.length} activos, ${places.filter((place) => place.ignored).length} descartados), ${benefits.filter((benefit) => benefit.active).length} beneficios vigentes (${benefits.filter((benefit) => benefit.active && benefit.expired).length} con la vigencia desactualizada en la fuente)`)
  console.log(`  Cruce (activos): ${counts.found} encontrados, ${counts.doubtful} dudosos, ${counts.missing} no están en la base, ${counts.not_matched} fuera de Montevideo · ${active.filter((place) => place.match.origin === 'manual').length} manuales`)
  for (const error of run.errors) console.log(`  ERROR ${error.url}: ${error.message}`)
  for (const warning of run.warnings) console.log(`  aviso: ${warning}`)
}

/** Lugares activos, beneficios vigentes y cruce de un proveedor (para el antes → después de --dry-run). */
function providerNumbers(places: DiscountPlace[], providerId: string): string {
  const active = places.filter((place) => place.providerId === providerId && place.active)
  const count = (status: string) => active.filter((place) => place.match.status === status).length
  const benefits = active.flatMap((place) => place.benefits).filter((benefit) => benefit.active)
  return `${active.length} activos (${count('found')} encontrados, ${count('doubtful')} dudosos, ${count('missing')} no están, ${count('not_matched')} fuera; ${active.filter((place) => place.match.origin === 'manual').length} manuales), ${benefits.length} beneficios`
}

/** Beneficios vigentes por tipo y niveles, antes → después (sólo los que cambian). */
function benefitChanges(before: DiscountPlace[], after: DiscountPlace[], providerId: string): string[] {
  const tally = (places: DiscountPlace[]) => {
    const counts = new Map<string, number>()
    for (const place of places.filter((item) => item.providerId === providerId && item.active)) {
      for (const benefit of place.benefits.filter((item) => item.active)) {
        const key = `${benefit.cardType}${benefit.cardTiers.length ? ` [${benefit.cardTiers.join(', ')}]` : ''}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
    return counts
  }
  const [a, b] = [tally(before), tally(after)]
  return [...new Set([...a.keys(), ...b.keys()])].sort().filter((key) => a.get(key) !== b.get(key)).map((key) => `${key}: ${a.get(key) ?? 0} → ${b.get(key) ?? 0}`)
}

/** Lugares activos cuyo cruce cambia (estado o vínculos), para revisar falsos positivos antes de escribir. */
function matchChanges(before: DiscountPlace[], after: DiscountPlace[], providerId: string): string[] {
  const key = (place: DiscountPlace) => `${place.match.status} [${place.match.links.map((item) => item.name).sort().join(', ')}]`
  const old = new Map(before.filter((place) => place.providerId === providerId).map((place) => [place.id, place]))
  return after
    .filter((place) => place.providerId === providerId && place.active)
    .flatMap((place) => {
      const previous = old.get(place.id)
      const was = previous ? key(previous) : '(nuevo)'
      return was === key(place) ? [] : [`${place.sourceName} (${place.id}): ${was} → ${key(place)}`]
    })
}

/** Descartes que cambian (sobre todo los de la regla de rubros), antes → después. */
function discardChanges(before: DiscountPlace[], after: DiscountPlace[], providerId: string): string[] {
  const label = (place: DiscountPlace | undefined) => {
    if (!place?.ignored) return 'visible'
    return `descartado (${place.discard?.origin === 'auto' ? place.discard.reason ?? 'regla' : 'a mano'})`
  }
  const old = new Map(before.filter((place) => place.providerId === providerId).map((place) => [place.id, place]))
  return after
    .filter((place) => place.providerId === providerId)
    .flatMap((place) => {
      const previous = old.get(place.id)
      const [was, now] = [previous ? label(previous) : '(nuevo)', label(place)]
      return was === now ? [] : [`${place.sourceName} (${place.id}, rubro «${place.category ?? '—'}»${place.montevideo ? '' : ', fuera de Montevideo'}): ${was} → ${now}`]
    })
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
  const unknown = only?.filter((id) => !DISCOUNT_PROVIDER_IDS.includes(id)) ?? []
  if (unknown.length) throw new Error(`Proveedores desconocidos: ${unknown.join(', ')}.`)
  const dryRun = process.argv.includes('--dry-run')
  const [{ db }, { drizzleDiscountCandidates }] = await Promise.all([import('../db/index.ts'), import('../places/list.ts')])
  const candidates = drizzleDiscountCandidates(db)
  // En seco: en memoria, sobre una copia de lo guardado (cruces manuales e ignorados incluidos), sin tocar la base.
  const before = dryRun ? await drizzleDiscountStore(db).list() : null
  const store = before ? memoryDiscountStore(await candidates(), { seed: before }) : drizzleDiscountStore(db)
  const run = await runDiscounts(discountRunDependencies({ store, candidates, fromRun, only }), { reparsedFrom: fromRun })
  const after = await store.list()
  if (before) {
    console.log('En seco: no se escribió nada en la base.')
    for (const provider of run.providers) {
      console.log(`  ${provider.name}: ${providerNumbers(before, provider.providerId)}  →  ${providerNumbers(after, provider.providerId)}`)
      for (const line of benefitChanges(before, after, provider.providerId)) console.log(`    ${line}`)
      const discards = discardChanges(before, after, provider.providerId)
      if (discards.length) console.log(`    Descartes automáticos que cambian (${discards.length}):`)
      for (const line of discards) console.log(`      ${line}`)
      const changes = matchChanges(before, after, provider.providerId)
      if (changes.length) console.log(`    Cruces que cambian (${changes.length}):`)
      for (const line of changes) console.log(`      ${line}`)
    }
  }
  summary(run, after)
  if (run.providers.every((provider) => provider.status === 'error')) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
