// Vuelve a correr postProcess sobre las extracciones guardadas en cache/extractions (salida del modelo + fuentes),
// sin llamar al LLM ni a las fuentes. Sólo pide Place Details (pago) para el nombre y la dirección del local, que no
// se guardan. Sólo escribe en la base con --apply-review: status y review_reasons de los lugares ya guardados,
// con la misma regla que el guardado (pipelineStatus); nada más del lugar y sin tocar updatedAt.
// Uso: yarn extraction:replay [--only <googlePlaceId>,…] [--json <archivo>] [--apply-review]
import './env.ts'
import { writeFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { OCCASION_TAGS } from '../../src/data/tags.ts'
import { reviewReasonLabel, type ReviewReason } from '../../src/data/review-reasons.ts'
import { places as placesTable } from '../db/schema.ts'
import { pipelineStatus } from '../places/save.ts'
import { readSnapshots, replaySnapshot } from '../providers/extraction-snapshots.ts'
import { GooglePlacesProvider } from '../providers/google-places-provider.ts'
import { reviewExtraction } from '../providers/place-extraction-service.ts'
import { instagramOperating, reviewReasonsFor } from '../providers/review-reasons.ts'

const arg = (name: string) => {
  const index = process.argv.indexOf(name)
  return index > 0 ? process.argv[index + 1] ?? null : null
}
const only = arg('--only')?.split(',').map((id) => id.trim()).filter(Boolean) ?? null
const jsonPath = arg('--json')
const applyReview = process.argv.includes('--apply-review')
if (applyReview && !process.env.DATABASE_URL) throw new Error('Falta configurar DATABASE_URL en .env.local: --apply-review escribe status y review_reasons.')
const db = applyReview ? (await import('../db/index.ts')).db : null

/** Escribe sólo status y review_reasons de un lugar guardado; devuelve qué pasó para el log. */
async function applyReviewStatus(googlePlaceId: string, reasons: ReviewReason[]): Promise<string> {
  const [row] = await db!.select({ id: placesTable.id, status: placesTable.status, manualOverrides: placesTable.manualOverrides })
    .from(placesTable).where(eq(placesTable.googlePlaceId, googlePlaceId))
  if (!row) return 'no está en la base'
  const status = pipelineStatus(row, reasons)
  const values = {
    ...(row.manualOverrides.includes('review_reasons') ? {} : { reviewReasons: reasons }),
    ...(status ? { status } : {}),
  }
  await db!.update(placesTable).set({ ...values, updatedAt: placesTable.updatedAt }).where(eq(placesTable.id, row.id))
  return status && status !== row.status ? `${row.status} → ${status}` : `sigue ${row.status}`
}

const key = process.env.GOOGLE_PLACES_API_KEY?.trim()
if (!key) throw new Error('Falta GOOGLE_PLACES_API_KEY: la re-corrida pide Place Details para el nombre y la dirección.')
const google = new GooglePlacesProvider(key)
const snapshots = (await readSnapshots()).filter((snapshot) => !only || only.includes(snapshot.googlePlaceId))
if (snapshots.length === 0) {
  console.log('No hay extracciones guardadas en cache/extractions (o ninguna coincide con --only).')
  process.exit(0)
}

const occasions = new Set<string>(OCCASION_TAGS)
const places = []
for (const snapshot of snapshots) {
  const replayed = await replaySnapshot(snapshot, google)
  // El logo no interviene en los motivos: reviewExtraction corre con sus valores por defecto. La actividad del
  // Instagram se mide a la fecha del snapshot (los de antes no la tienen: cuenta como sin Instagram activo).
  const operating = instagramOperating(snapshot.instagramActivity, new Date(snapshot.savedAt))
  const place = { ...replayed, reviewReasons: reviewReasonsFor(replayed, reviewExtraction(replayed, snapshot.llmOutput), { instagramOperating: operating }) }
  places.push(place)
  const facts = new Map(place.placeFacts.map((fact) => [fact.id, fact]))
  console.log(`\n${place.name || snapshot.googlePlaceId} · style: ${place.style ?? '—'} · momentos: ${place.tags.filter((tag) => occasions.has(tag)).join(', ') || '—'} · cozy: ${place.tags.includes('cozy') ? 'sí' : 'no'}`)
  console.log(`  a revisar: ${place.reviewReasons.length > 0 ? place.reviewReasons.map(reviewReasonLabel).join(' · ') : 'no'}${applyReview ? ` · base: ${await applyReviewStatus(snapshot.googlePlaceId, place.reviewReasons)}` : ''}`)
  for (const evidence of place.tagEvidence ?? []) {
    console.log(`  ${evidence.tag} (${evidence.mode === 'explicit' ? 'explícito' : 'inferido'}): ${evidence.signals.join(' + ') || 'sin señal'}`)
    for (const factId of evidence.factIds) {
      const fact = facts.get(factId)
      if (fact) console.log(`    ${factId} · ${fact.text} · ${fact.sourceUrl}`)
    }
  }
}
console.log(`\n${places.length} lugares, ${places.length} Place Details pedidos (US$ ${(places.length * 0.025).toFixed(3)} aprox.).`)
if (jsonPath) writeFileSync(jsonPath, JSON.stringify(places, null, 2))
