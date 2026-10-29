// Vacía review_reasons de los lugares publicados que todavía los tienen (publicados a mano antes de que publicar los
// vaciara). Por defecto no escribe: lista los lugares con sus motivos. --write los vacía y los bloquea vacíos en
// manual_overrides (como Publicar), sin tocar updatedAt. Uso: yarn places:clear-review-reasons [--write]
import './env.ts'
import { and, eq, sql } from 'drizzle-orm'
import { reviewReasonLabel } from '../../src/data/review-reasons.ts'
import { places } from '../db/schema.ts'

async function main() {
  const write = process.argv.includes('--write')
  if (!process.env.DATABASE_URL) throw new Error('Falta configurar DATABASE_URL en .env.local.')
  const { db } = await import('../db/index.ts')
  const stale = and(eq(places.status, 'published'), sql`${places.reviewReasons} <> '{}'::text[]`)
  const rows = await db.select({ id: places.id, name: places.name, reviewReasons: places.reviewReasons, manualOverrides: places.manualOverrides })
    .from(places).where(stale).orderBy(places.name)
  console.log(`Publicados con motivos de revisión: ${rows.length}`)
  for (const row of rows) {
    const manual = (row.manualOverrides as Record<string, unknown> | null)?.status === 'published' ? ' · publicado a mano' : ''
    console.log(`  ${row.name} · ${row.reviewReasons.map(reviewReasonLabel).join(' · ')}${manual}`)
  }
  if (!write) {
    console.log('Sin escribir: --write vacía review_reasons en estos lugares.')
    return
  }
  const updated = await db.update(places)
    .set({
      reviewReasons: [],
      manualOverrides: sql`${places.manualOverrides} || '{"review_reasons":[]}'::jsonb`,
      updatedAt: places.updatedAt,
    })
    .where(stale)
    .returning({ id: places.id })
  console.log(`Escritos: ${updated.length}.`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
