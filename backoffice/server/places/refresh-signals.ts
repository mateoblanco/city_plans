import pMap from 'p-map'
import type { ExaPlaceResponse } from '../../src/types/places.ts'
import type { InstagramProfileData } from '../providers/apify-instagram-provider.ts'
import { brandSearchTerm } from '../providers/brand-name.ts'
import { isChainBranch, isForeignSource, type Source } from '../providers/place-extraction-service.ts'
import { withServiceLimit } from '../providers/service-limits.ts'
import type { ExtractionSnapshot } from '../providers/extraction-snapshots.ts'
import { canonical } from '../providers/source-hosts.ts'
import { computeProminence, type ProminenceSignals } from './prominence.ts'
import { applyOverrides } from './manual-overrides.ts'
import { sharedBrandKeys } from './brand-key.ts'
import type { ManualOverrides } from '../../src/data/manual-overrides.ts'

const REFRESH_CONCURRENCY = 4

/** Lo que signals:refresh lee de cada lugar guardado. */
export type SignalsRow = ProminenceSignals & {
  chainBranch: boolean
  id: string
  googlePlaceId: string | null
  name: string
  instagram: string | null
  prominence: number
  /** brand_key guardada: compartida con otro lugar, es sucursal de cadena. */
  brandKey?: string | null
  /** Campos editados a mano: lo que se escribe pasa por applyOverrides. */
  manualOverrides?: ManualOverrides
}

export type SignalsUpdate = { igFollowers: number | null; chainBranch: boolean; prominence: number }

export type RefreshDeps = {
  /** Exa con la marca y el tipo de lugar, la misma búsqueda que hace el pipeline. Sirve para detectar cadenas. */
  searchPlace(term: string): Promise<ExaPlaceResponse>
  /** Tipo de lugar de Google (primaryTypeDisplayName), sólo para la consulta. */
  placeType?(googlePlaceId: string): Promise<string | null>
  /** Perfil de Instagram por Apify; null si no lo devuelve. */
  scrapeInstagram(profileUrl: string): Promise<InstagramProfileData | null>
  /** Sin write es un dry-run: calcula y no escribe. */
  write?(id: string, values: SignalsUpdate): Promise<void>
}

export type RefreshResult = {
  id: string
  name: string
  status: 'changed' | 'unchanged' | 'error'
  before: SignalsUpdate
  after: SignalsUpdate | null
  chain: boolean
  warnings: string[]
  error?: string
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const brandKey = (name: string) => canonical(name).replace(/[^a-z0-9]+/g, ' ').trim()

/** instagram se guarda como handle; Apify necesita la URL del perfil. */
export function instagramProfileUrl(handle: string) {
  return `https://www.instagram.com/${handle.replace(/^@/, '').trim().toLowerCase()}/`
}

function sameSignals(left: SignalsUpdate, right: SignalsUpdate) {
  return left.igFollowers === right.igFollowers && left.chainBranch === right.chainBranch && Math.abs(left.prominence - right.prominence) < 1e-6
}

const update = (igFollowers: number | null, chainBranch: boolean): SignalsUpdate =>
  ({ igFollowers, chainBranch, prominence: computeProminence({ igFollowers, chainBranch }) })

const brandCountsOf = (rows: { name: string }[]) => {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(brandKey(row.name), (counts.get(brandKey(row.name)) ?? 0) + 1)
  return counts
}

/**
 * Vuelve a leer los seguidores de Instagram de lugares guardados y recalcula prominence, sin LLM.
 * Exa (con la marca y el tipo de lugar de Google) sólo sirve para saber si es una sucursal de cadena:
 * ahí los seguidores son de la marca y computeProminence los descuenta. No toca ninguna otra columna. Una falla de un
 * lugar no corta el resto; si falla sólo Instagram, los seguidores quedan como estaban.
 * Sin el nombre de Google, es cadena si las fuentes muestran varias sucursales, si hay más de un
 * lugar guardado con la misma marca o si comparte brand_key con otro lugar.
 */
export async function refreshSignals(rows: SignalsRow[], deps: RefreshDeps, options: { onlyIds?: ReadonlySet<string> } = {}): Promise<RefreshResult[]> {
  // Las marcas repetidas se cuentan sobre todos los lugares, aunque se procesen sólo algunos.
  const brandCounts = brandCountsOf(rows)
  const shared = sharedBrandKeys(rows)
  const selected = options.onlyIds ? rows.filter((row) => options.onlyIds!.has(row.id)) : rows

  return pMap(selected, async (row): Promise<RefreshResult> => {
    const before: SignalsUpdate = { igFollowers: row.igFollowers, chainBranch: row.chainBranch, prominence: row.prominence }
    const base = { id: row.id, name: row.name, before }
    const warnings: string[] = []
    let placeType: string | null = null
    if (deps.placeType && row.googlePlaceId) {
      try {
        placeType = await deps.placeType(row.googlePlaceId)
      } catch (error) {
        warnings.push(`Google: ${message(error)}; se busca sólo con la marca`)
      }
    }
    let exa: ExaPlaceResponse
    try {
      exa = await withServiceLimit('exa', () => deps.searchPlace(brandSearchTerm(row.name, placeType)))
    } catch (error) {
      return { ...base, status: 'error', after: null, chain: false, warnings, error: `Exa: ${message(error)}` }
    }

    const sources = exa.results
      .map((result): Source => ({ id: '', kind: 'exa', trust: 'third_party', url: result.url, text: result.text?.trim() || result.highlights.join('\n') }))
      .filter((source) => !isForeignSource(source.url, source.text))
    const chain = (brandCounts.get(brandKey(row.name)) ?? 0) > 1 || shared.has(row.id) || isChainBranch({ name: row.name }, sources)

    let igFollowers: number | null = null
    if (row.instagram) {
      try {
        const profile = await withServiceLimit('apify', () => deps.scrapeInstagram(instagramProfileUrl(row.instagram!)))
        if (typeof profile?.followers === 'number') igFollowers = profile.followers
        else {
          igFollowers = row.igFollowers
          warnings.push('Instagram: el perfil no trajo seguidores; quedan los anteriores')
        }
      } catch (error) {
        igFollowers = row.igFollowers
        warnings.push(`Instagram: ${message(error)}; quedan los seguidores anteriores`)
      }
    }

    const after = update(igFollowers, chain)
    const result = { ...base, after, chain, warnings }
    if (sameSignals(before, after)) return { ...result, status: 'unchanged' }
    if (deps.write) {
      try {
        await deps.write(row.id, applyOverrides(after, row.manualOverrides ?? {}))
      } catch (error) {
        return { ...result, status: 'error', error: `No se pudo guardar: ${message(error)}` }
      }
    }
    return { ...result, status: 'changed' }
  }, { concurrency: REFRESH_CONCURRENCY })
}

export type SnapshotSignalsResult = {
  id: string
  name: string
  status: 'changed' | 'unchanged' | 'skipped'
  before: SignalsUpdate
  after: SignalsUpdate | null
  /** Por qué no se calculó (sin snapshot, el snapshot es de otro Instagram…). */
  reason?: string
}

/**
 * Completa los seguidores que faltan (lugares con instagram y sin igFollowers) con los que ya midió el pipeline y
 * quedaron en cache/extractions, sin Apify ni Exa. Es cadena sólo con evidencia: las fuentes del snapshot muestran
 * sucursales o hay más de un lugar guardado con la misma marca, igual que refreshSignals. Sin write, no escribe (dry-run).
 */
export async function signalsFromSnapshots(
  rows: SignalsRow[],
  snapshots: Pick<ExtractionSnapshot, 'googlePlaceId' | 'sources' | 'prominenceSignals' | 'instagramAudit'>[],
  deps: { write?(id: string, values: SignalsUpdate): Promise<void> } = {},
  options: { onlyIds?: ReadonlySet<string> } = {},
): Promise<SnapshotSignalsResult[]> {
  const brandCounts = brandCountsOf(rows)
  const shared = sharedBrandKeys(rows)
  const byPlaceId = new Map(snapshots.map((snapshot) => [snapshot.googlePlaceId, snapshot]))
  const selected = rows.filter((row) => row.instagram && row.igFollowers === null && (!options.onlyIds || options.onlyIds.has(row.id)))
  const results: SnapshotSignalsResult[] = []
  for (const row of selected) {
    const before: SignalsUpdate = { igFollowers: row.igFollowers, chainBranch: row.chainBranch, prominence: row.prominence }
    const base = { id: row.id, name: row.name, before, after: null }
    const snapshot = row.googlePlaceId ? byPlaceId.get(row.googlePlaceId) : undefined
    const followers = snapshot?.prominenceSignals?.instagramFollowers ?? null
    const saved = snapshot?.instagramAudit?.saved
    if (!snapshot) results.push({ ...base, status: 'skipped', reason: 'sin snapshot' })
    else if (saved && saved.toLowerCase() !== row.instagram!.replace(/^@/, '').toLowerCase()) results.push({ ...base, status: 'skipped', reason: `el snapshot es de @${saved}` })
    else if (followers === null) results.push({ ...base, status: 'skipped', reason: 'el snapshot no tiene seguidores' })
    else {
      const chain = (brandCounts.get(brandKey(row.name)) ?? 0) > 1 || shared.has(row.id) || isChainBranch({ name: row.name }, snapshot.sources)
      const after = update(followers, chain)
      if (sameSignals(before, after)) results.push({ ...base, after, status: 'unchanged' })
      else {
        await deps.write?.(row.id, applyOverrides(after, row.manualOverrides ?? {}))
        results.push({ ...base, after, status: 'changed' })
      }
    }
  }
  return results
}
