// Vuelve a correr postProcess sobre las extracciones guardadas en cache/extractions (salida del modelo + fuentes),
// sin llamar al LLM ni a las fuentes. Sólo pide Place Details (pago) para el nombre y la dirección del local, que no
// se guardan. Sólo escribe en la base con --apply-review: status y review_reasons de los lugares ya guardados,
// con la misma regla que el guardado (pipelineStatus); nada más del lugar y sin tocar updatedAt.
// --style lista los lugares guardados donde cambiaría el style (antes → después, de dónde sale y el costo del embedding),
// sin escribir; --apply-style además escribe style, keyword_text, embedding_text y el embedding de esos lugares (nada
// más, sin tocar updatedAt). Los dos leen la base y no piden Place Details: el style no depende del nombre ni de la
// dirección, que salen de la salida guardada del modelo.
// --moments lista los lugares guardados donde cambiarían los momentos (groups, date…: +agregados −sacados y el costo del
// embedding), sin escribir; --apply-moments escribe en esos lugares sólo los tags de momento (los demás tags quedan),
// keyword_text, embedding_text y el embedding, igual que --apply-style y sin Place Details.
// --tags <id>,… lista lo mismo para esos tags (dancing, accessible…), sin escribir; --apply-tags <id>,… los escribe.
// --review lista, sin escribir, cómo quedarían status y review_reasons de los lugares guardados (lo que escribiría
// --apply-review), contra lo guardado y sin Place Details: el nombre y la dirección salen del snapshot.
// --branch-contact lista, sin escribir, los lugares de cadena (chain_branch guardado, brand_key o Instagram compartidos)
// cuyo teléfono o dirección guardados cambiarían con las reglas de sucursal (antes → después y por qué), y el horario
// sólo como aviso. Pide Place Details de esos lugares (la dirección real decide qué fuente es de la sucursal).
// --apply-branch-contact escribe sólo phone y address de esos lugares, sin tocar updatedAt.
// Uso: yarn extraction:replay [--only <googlePlaceId>,…] [--json <archivo>] [--review | --apply-review] [--style | --apply-style] [--moments | --apply-moments] [--tags | --apply-tags <id>,…] [--branch-contact | --apply-branch-contact]
import './env.ts'
import { writeFileSync } from 'node:fs'
import { eq, inArray } from 'drizzle-orm'
import { groupOf, OCCASION_TAGS } from '../../src/data/tags.ts'
import { reviewReasonLabel, type ReviewReason } from '../../src/data/review-reasons.ts'
import { places as placesTable } from '../db/schema.ts'
import { pipelineStatus } from '../places/save.ts'
import { applyOverrides } from '../places/manual-overrides.ts'
import { parseManualOverrides } from '../../src/data/manual-overrides.ts'
import { readSnapshots, replaySnapshot } from '../providers/extraction-snapshots.ts'
import { GooglePlacesProvider } from '../providers/google-places-provider.ts'
import { brandWidePhone, reviewExtraction, targetFromDetails } from '../providers/place-extraction-service.ts'
import { instagramKey, sharedBrandKeys } from '../places/brand-key.ts'
import { instagramOperating, reviewReasonsFor } from '../providers/review-reasons.ts'
import { gatewayEmbedder } from '../places/save.ts'
import {
  applySearchTextChanges, planMomentsChange, planStyleChange, planTagsChange, type SearchTextRow, type StyleChange, type TagsChange,
} from '../places/search-text-backfill.ts'

const arg = (name: string) => {
  const index = process.argv.indexOf(name)
  return index > 0 ? process.argv[index + 1] ?? null : null
}
const only = arg('--only')?.split(',').map((id) => id.trim()).filter(Boolean) ?? null
const jsonPath = arg('--json')
const applyReview = process.argv.includes('--apply-review')
const reviewMode = process.argv.includes('--review')
const applyStyle = process.argv.includes('--apply-style')
const styleMode = applyStyle || process.argv.includes('--style')
const applyMoments = process.argv.includes('--apply-moments')
const momentsMode = applyMoments || process.argv.includes('--moments')
const applyTags = process.argv.includes('--apply-tags')
const tagIds = (arg('--apply-tags') ?? arg('--tags'))?.split(',').map((id) => id.trim()).filter(Boolean) ?? null
const tagsMode = tagIds !== null
const applyBranchContact = process.argv.includes('--apply-branch-contact')
const branchContactMode = applyBranchContact || process.argv.includes('--branch-contact')
if ((applyTags || process.argv.includes('--tags')) && !tagIds?.every((id) => groupOf(id))) throw new Error('--tags y --apply-tags llevan ids de tags.ts separados por coma.')
if ([styleMode, momentsMode, tagsMode, reviewMode || applyReview, branchContactMode].filter(Boolean).length > 1) throw new Error('--style, --moments, --tags, --review y --branch-contact van por separado.')
if (reviewMode && applyReview) throw new Error('--review lista sin escribir; --apply-review escribe: uno u otro.')
if (applyReview && !process.env.DATABASE_URL) throw new Error('Falta configurar DATABASE_URL en .env.local: --apply-review escribe status y review_reasons.')
if ((styleMode || momentsMode || tagsMode || reviewMode || branchContactMode) && !process.env.DATABASE_URL) throw new Error('Falta configurar DATABASE_URL en .env.local: --style, --moments, --tags, --review y --branch-contact comparan con lo guardado.')
const db = applyReview || styleMode || momentsMode || tagsMode || reviewMode || branchContactMode ? (await import('../db/index.ts')).db : null

/**
 * googlePlaceId de los lugares guardados que tienen otro lugar de la misma marca (brand_key o Instagram compartidos),
 * como BrandSiblings en /api/extract. Sin base, vacío.
 */
async function knownChains(): Promise<Set<string>> {
  if (!db) return new Set()
  const rows = await db.select({ id: placesTable.id, googlePlaceId: placesTable.googlePlaceId, brandKey: placesTable.brandKey, instagram: placesTable.instagram }).from(placesTable)
  const shared = sharedBrandKeys(rows)
  const handles = new Map<string, number>()
  for (const row of rows) { const handle = instagramKey(row.instagram); if (handle) handles.set(handle, (handles.get(handle) ?? 0) + 1) }
  return new Set(rows.flatMap((row) => row.googlePlaceId && (shared.has(row.id) || (handles.get(instagramKey(row.instagram) ?? '') ?? 0) > 1) ? [row.googlePlaceId] : []))
}
const chains = await knownChains()

/** Escribe sólo status y review_reasons de un lugar guardado; devuelve qué pasó para el log. */
async function applyReviewStatus(googlePlaceId: string, reasons: ReviewReason[]): Promise<string> {
  const [row] = await db!.select({ id: placesTable.id, status: placesTable.status, manualOverrides: placesTable.manualOverrides })
    .from(placesTable).where(eq(placesTable.googlePlaceId, googlePlaceId))
  if (!row) return 'no está en la base'
  const manualOverrides = parseManualOverrides(row.manualOverrides)
  const status = pipelineStatus({ status: row.status, manualOverrides }, reasons)
  const values = applyOverrides({ reviewReasons: reasons, ...(status ? { status } : {}) }, manualOverrides)
  await db!.update(placesTable).set({ ...values, updatedAt: placesTable.updatedAt }).where(eq(placesTable.id, row.id))
  return status && status !== row.status ? `${row.status} → ${status}` : `sigue ${row.status}`
}

const snapshots = (await readSnapshots()).filter((snapshot) => !only || only.includes(snapshot.googlePlaceId))
if (snapshots.length === 0) {
  console.log('No hay extracciones guardadas en cache/extractions (o ninguna coincide con --only).')
  process.exit(0)
}

if (styleMode || momentsMode || tagsMode) {
  const rows: SearchTextRow[] = (await db!.select({
    id: placesTable.id, googlePlaceId: placesTable.googlePlaceId, name: placesTable.name, neighborhoodId: placesTable.neighborhoodId,
    descriptionEs: placesTable.descriptionEs, descriptionEn: placesTable.descriptionEn, locatedIn: placesTable.locatedIn,
    categories: placesTable.categories, tags: placesTable.tags, dietVegan: placesTable.dietVegan, dietVegetarian: placesTable.dietVegetarian,
    dietGlutenFree: placesTable.dietGlutenFree, highlights: placesTable.highlights, dishes: placesTable.dishes, signature: placesTable.signature,
    style: placesTable.style, manualOverrides: placesTable.manualOverrides,
  }).from(placesTable).where(inArray(placesTable.googlePlaceId, snapshots.map((snapshot) => snapshot.googlePlaceId))))
    .map((row) => ({ ...row, manualOverrides: parseManualOverrides(row.manualOverrides) }))
  const byPlaceId = new Map(rows.map((row) => [row.googlePlaceId, row]))
  const changes: (StyleChange | TagsChange)[] = []
  // Con --tags, el respaldo de cada tag pedido: el fragmento que lo dispara y su fuente.
  const evidenceLines = new Map<string, string[]>()
  const wanted = (id: string): id is string => tagIds!.includes(id)
  let unchanged = 0
  for (const snapshot of snapshots) {
    const row = byPlaceId.get(snapshot.googlePlaceId)
    if (!row) continue
    // Sin Place Details: el nombre y la dirección salen de la salida guardada del modelo.
    const llm = snapshot.llmOutput as { name?: string; address?: string }
    const details = { getDetails: async () => ({ anchor: { name: llm.name || row.name, address: llm.address || '', latitude: 0, longitude: 0 } }) }
    const replayed = await replaySnapshot({ ...snapshot, request: { ...snapshot.request, neighborhoodId: row.neighborhoodId } }, details as never)
    const change = styleMode ? planStyleChange(row, replayed) : momentsMode ? planMomentsChange(row, replayed) : planTagsChange(row, replayed, wanted)
    if (change) changes.push(change)
    else unchanged += 1
    if (change && tagsMode) {
      const facts = new Map(replayed.placeFacts.map((fact) => [fact.id, fact]))
      evidenceLines.set(change.id, (replayed.tagEvidence ?? []).filter((evidence) => wanted(evidence.tag)).flatMap((evidence) => [
        `  ${evidence.tag} (${evidence.mode === 'explicit' ? 'explícito' : 'inferido'}): ${evidence.signals.join(' + ') || 'sin señal'}`,
        ...evidence.factIds.flatMap((factId) => { const fact = facts.get(factId); return fact ? [`    ${factId} · ${fact.text} · ${fact.sourceUrl}`] : [] }),
      ]))
    }
  }
  const BASIS = { signals: 'señales', price: 'precio', icon: 'ícono' } as const
  const describe = (change: StyleChange | TagsChange) => 'basis' in change
    ? `${change.before ?? '—'} → ${change.after} · ${change.basis ? BASIS[change.basis] : '?'}`
    : `${change.before.join(', ') || '—'} → ${change.after.join(', ') || '—'} · ${[...change.added.map((id) => `+${id}`), ...change.removed.map((id) => `−${id}`)].join(' ')}`
  for (const change of changes) {
    console.log(`${change.name} · ${describe(change)}` +
      (change.skipped ? ' · editado a mano: no se escribe' : ` · embedding US$ ${change.estimatedEmbeddingUsd.toFixed(6)}`))
    for (const line of evidenceLines.get(change.id) ?? []) console.log(line)
  }
  const total = changes.reduce((sum, change) => sum + change.estimatedEmbeddingUsd, 0)
  console.log(`\n${changes.length} cambian, ${unchanged} quedan igual, ${snapshots.length - rows.length} snapshots sin lugar en la base. Embeddings: US$ ${total.toFixed(6)} aprox.`)
  if (applyStyle || applyMoments || applyTags) {
    const overridesById = new Map(rows.map((row) => [row.id, row.manualOverrides]))
    const result = await applySearchTextChanges(changes, {
      embed: gatewayEmbedder,
      // Los planes ya respetan los overrides; aplicarlos otra vez al escribir no cambia nada y protege el camino.
      write: async (id, values) => {
        await db!.update(placesTable).set({ ...applyOverrides(values, overridesById.get(id) ?? {}), updatedAt: placesTable.updatedAt }).where(eq(placesTable.id, id))
      },
    })
    console.log(`Escritos: ${result.written}.${result.embedError ? ` ${result.embedError}` : ''}`)
  } else {
    console.log(`Sin escribir: ${styleMode ? '--apply-style' : momentsMode ? '--apply-moments' : `--apply-tags ${tagIds!.join(',')}`} escribe estos cambios.`)
  }
  process.exit(0)
}

if (reviewMode) {
  const rows = await db!.select({
    googlePlaceId: placesTable.googlePlaceId, name: placesTable.name, status: placesTable.status,
    reviewReasons: placesTable.reviewReasons, manualOverrides: placesTable.manualOverrides,
  }).from(placesTable).where(inArray(placesTable.googlePlaceId, snapshots.map((snapshot) => snapshot.googlePlaceId)))
  const byPlaceId = new Map(rows.map((row) => [row.googlePlaceId, row]))
  const leave: string[] = [], enter: string[] = [], stay: string[] = [], reasonsOnly: string[] = []
  const labels = (reasons: readonly string[]) => reasons.map((reason) => reviewReasonLabel(reason as ReviewReason)).join(' · ') || '—'
  for (const snapshot of snapshots) {
    const row = byPlaceId.get(snapshot.googlePlaceId)
    if (!row) continue
    // Sin Place Details, como --style: el nombre y la dirección salen de la salida guardada del modelo.
    const llm = snapshot.llmOutput as { name?: string; address?: string }
    const details = { getDetails: async () => ({ anchor: { name: llm.name || row.name, address: llm.address || '', latitude: 0, longitude: 0 } }) }
    const replayed = await replaySnapshot(snapshot, details as never, { knownChain: chains.has(snapshot.googlePlaceId) })
    const operating = instagramOperating(snapshot.instagramActivity, new Date(snapshot.savedAt))
    const reasons = reviewReasonsFor(replayed, reviewExtraction(replayed, snapshot.llmOutput), { instagramOperating: operating, chainBranch: replayed.signals.chainBranch })
    const manualOverrides = parseManualOverrides(row.manualOverrides)
    const status = pipelineStatus({ status: row.status, manualOverrides }, reasons) ?? row.status
    const locked = Object.hasOwn(manualOverrides, 'status') ? ' (status fijado a mano)' : ''
    const line = `${row.name} · antes: ${labels(row.reviewReasons ?? [])} · después: ${labels(reasons)}${locked}`
    if (row.status === 'review' && status !== 'review') leave.push(line)
    else if (row.status !== 'review' && status === 'review') enter.push(line)
    else if (status === 'review') stay.push(line)
    // Status fijado a mano (Publicar): el status no se mueve, pero los motivos guardados sí cambian.
    else if (labels(row.reviewReasons ?? []) !== labels(reasons)) reasonsOnly.push(line)
  }
  for (const [title, lines] of [['Salen de "A revisar"', leave], ['Entran a "A revisar"', enter], ['Siguen en "A revisar"', stay], ['Cambian sólo los motivos', reasonsOnly]] as const) {
    console.log(`\n${title}: ${lines.length}`)
    for (const line of lines) console.log(`  ${line}`)
  }
  console.log(`\nSin escribir: --apply-review escribe status y review_reasons. ${snapshots.length - rows.length} snapshots sin lugar en la base.`)
  process.exit(0)
}

const key = process.env.GOOGLE_PLACES_API_KEY?.trim()
if (!key) throw new Error('Falta GOOGLE_PLACES_API_KEY: la re-corrida pide Place Details para el nombre y la dirección.')
const google = new GooglePlacesProvider(key)

if (branchContactMode) {
  const rows = await db!.select({
    id: placesTable.id, googlePlaceId: placesTable.googlePlaceId, name: placesTable.name, neighborhoodId: placesTable.neighborhoodId,
    phone: placesTable.phone, address: placesTable.address, hours: placesTable.hours, chainBranch: placesTable.chainBranch, manualOverrides: placesTable.manualOverrides,
  }).from(placesTable).where(inArray(placesTable.googlePlaceId, snapshots.map((snapshot) => snapshot.googlePlaceId)))
  const byPlaceId = new Map(rows.map((row) => [row.googlePlaceId, row]))
  const candidates = snapshots.filter((snapshot) => { const row = byPlaceId.get(snapshot.googlePlaceId); return row && (row.chainBranch || chains.has(snapshot.googlePlaceId)) })
  console.log(`${candidates.length} lugares de cadena con snapshot: ${candidates.length} Place Details (US$ ${(candidates.length * 0.025).toFixed(3)} aprox.).\n`)
  const changes: { id: string; name: string; values: { phone?: string | null; address?: string | null }; overrides: ReturnType<typeof parseManualOverrides> }[] = []
  for (const snapshot of candidates) {
    const row = byPlaceId.get(snapshot.googlePlaceId)!
    const withNeighborhood = { ...snapshot, request: { ...snapshot.request, neighborhoodId: row.neighborhoodId } }
    let replayed, details
    try {
      details = await google.getDetails(snapshot.googlePlaceId)
      replayed = await replaySnapshot(withNeighborhood, { getDetails: async () => details! }, { knownChain: chains.has(snapshot.googlePlaceId) })
    } catch (error) {
      console.log(`${row.name} · Place Details falló: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    const target = targetFromDetails(snapshot.googlePlaceId, details, withNeighborhood.request, snapshot.transit)
    const brandPhone = brandWidePhone(snapshot.sources, target)
    const values: { phone?: string | null; address?: string | null } = {}
    const lines: string[] = []
    if ((row.phone ?? null) !== replayed.contact.phone) {
      values.phone = replayed.contact.phone
      const why = !replayed.contact.phone ? 'ninguna fuente lo asocia a esta sucursal' : replayed.contact.phone === brandPhone ? 'teléfono único de la marca' : 'de esta sucursal'
      lines.push(`  teléfono: ${row.phone ?? '—'} → ${replayed.contact.phone ?? 'vacío'} (${why})`)
    } else if (row.phone) {
      lines.push(`  teléfono: ${row.phone} queda (${row.phone === brandPhone ? 'teléfono único de la marca' : 'de esta sucursal'})`)
    }
    if ((row.address ?? null) !== replayed.address) {
      values.address = replayed.address
      lines.push(`  dirección: ${row.address ?? '—'} → ${replayed.address ?? 'vacía'}${replayed.address ? '' : ' (ninguna fuente la asocia a esta sucursal)'}`)
    }
    const hoursBefore = (row.hours as { status?: string } | null)?.status ?? 'none'
    if (hoursBefore !== replayed.hours.status) lines.push(`  horario (sólo aviso, no se escribe): ${hoursBefore} → ${replayed.hours.status}`)
    console.log(`${row.name} · ${details.anchor.address}`)
    for (const line of lines.length ? lines : ['  sin cambios']) console.log(line)
    if (Object.keys(values).length > 0) changes.push({ id: row.id, name: row.name, values, overrides: parseManualOverrides(row.manualOverrides) })
  }
  console.log(`\n${changes.length} lugares cambiarían teléfono o dirección.`)
  if (applyBranchContact) {
    for (const change of changes) {
      await db!.update(placesTable).set({ ...applyOverrides(change.values, change.overrides), updatedAt: placesTable.updatedAt }).where(eq(placesTable.id, change.id))
    }
    console.log(`Escritos: ${changes.length}.`)
  } else {
    console.log('Sin escribir: --apply-branch-contact escribe phone y address.')
  }
  process.exit(0)
}

const occasions = new Set<string>(OCCASION_TAGS)
const places = []
for (const snapshot of snapshots) {
  const replayed = await replaySnapshot(snapshot, google, { knownChain: chains.has(snapshot.googlePlaceId) })
  // El logo no interviene en los motivos: reviewExtraction corre con sus valores por defecto. La actividad del
  // Instagram se mide a la fecha del snapshot (los de antes no la tienen: cuenta como sin Instagram activo).
  const operating = instagramOperating(snapshot.instagramActivity, new Date(snapshot.savedAt))
  const place = { ...replayed, reviewReasons: reviewReasonsFor(replayed, reviewExtraction(replayed, snapshot.llmOutput), { instagramOperating: operating, chainBranch: replayed.signals.chainBranch }) }
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
