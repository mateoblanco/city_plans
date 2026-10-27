import pMap from 'p-map'
import type { ExaPlaceResponse } from '../../src/types/places.ts'
import type { InstagramProfileData } from '../providers/apify-instagram-provider.ts'
import { brandSearchTerm } from '../providers/brand-name.ts'
import { isForeignSource, officialBranchEvidence, type Source } from '../providers/place-extraction-service.ts'
import { withServiceLimit } from '../providers/service-limits.ts'
import type { ExtractionSnapshot } from '../providers/extraction-snapshots.ts'
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
  /** Web guardada: un resultado de su dominio cuenta como fuente oficial para la cadena. */
  website?: string | null
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
  /** Prominence de un lugar sin seguidores (`drizzleIgMedian`), calculada una vez por corrida. */
  igMedian: number
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

/** instagram se guarda como handle; Apify necesita la URL del perfil. */
export function instagramProfileUrl(handle: string) {
  return `https://www.instagram.com/${handle.replace(/^@/, '').trim().toLowerCase()}/`
}

function sameSignals(left: SignalsUpdate, right: SignalsUpdate) {
  return left.igFollowers === right.igFollowers && left.chainBranch === right.chainBranch && Math.abs(left.prominence - right.prominence) < 1e-6
}

const update = (igFollowers: number | null, chainBranch: boolean, igMedian: number): SignalsUpdate =>
  ({ igFollowers, chainBranch, prominence: computeProminence({ igFollowers, chainBranch }, igMedian) })

/**
 * Sucursal de cadena, la misma regla que el pipeline para chain_branch: comparte brand_key con otro lugar guardado o
 * una fuente oficial (la web o el Instagram guardados) muestra varias sucursales. No alcanzan el nombre repetido ni
 * fuentes de terceros.
 */
const isChain = (row: SignalsRow, shared: ReadonlySet<string>, sources: Source[]) =>
  shared.has(row.id) || officialBranchEvidence(sources, { website: row.website ?? null, instagram: row.instagram }).length > 0

/**
 * Vuelve a leer los seguidores de Instagram de lugares guardados y recalcula prominence, sin LLM.
 * Exa (con la marca y el tipo de lugar de Google) sólo sirve para saber si es una sucursal de cadena:
 * ahí los seguidores son de la marca y computeProminence los descuenta. No toca ninguna otra columna. Una falla de un
 * lugar no corta el resto; si falla sólo Instagram, los seguidores quedan como estaban.
 * Es cadena si comparte brand_key con otro lugar o un resultado del dominio de su web muestra varias sucursales.
 */
export async function refreshSignals(rows: SignalsRow[], deps: RefreshDeps, options: { onlyIds?: ReadonlySet<string> } = {}): Promise<RefreshResult[]> {
  // Las brand_key compartidas se cuentan sobre todos los lugares, aunque se procesen sólo algunos.
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
    const chain = isChain(row, shared, sources)

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

    const after = update(igFollowers, chain, deps.igMedian)
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
 * quedaron en cache/extractions, sin Apify ni Exa. Es cadena con la misma regla que refreshSignals, con las fuentes
 * del snapshot. Sin write, no escribe (dry-run).
 */
export async function signalsFromSnapshots(
  rows: SignalsRow[],
  snapshots: Pick<ExtractionSnapshot, 'googlePlaceId' | 'sources' | 'prominenceSignals' | 'instagramAudit'>[],
  deps: { igMedian: number; write?(id: string, values: SignalsUpdate): Promise<void> },
  options: { onlyIds?: ReadonlySet<string> } = {},
): Promise<SnapshotSignalsResult[]> {
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
      const chain = isChain(row, shared, snapshot.sources)
      const after = update(followers, chain, deps.igMedian)
      if (sameSignals(before, after)) results.push({ ...base, after, status: 'unchanged' })
      else {
        await deps.write?.(row.id, applyOverrides(after, row.manualOverrides ?? {}))
        results.push({ ...base, after, status: 'changed' })
      }
    }
  }
  return results
}

export type ChainChange = {
  id: string
  name: string
  before: SignalsUpdate
  after: SignalsUpdate
  /** brand_key compartida, o las URLs oficiales que muestran sucursales; vacío si pasa a false. */
  evidence: string[]
}

/**
 * chain_branch de todos los lugares con la regla de isChain, sin Exa, Apify ni LLM: brand_key compartida o las fuentes
 * oficiales del snapshot (cache/extractions). Devuelve sólo los que cambian, en las dos direcciones. Sin snapshot y sin
 * brand_key compartida no hay con qué decidir: queda como está. Un chain_branch puesto a mano tampoco cambia.
 */
export function recomputeChains(
  rows: SignalsRow[],
  snapshots: Pick<ExtractionSnapshot, 'googlePlaceId' | 'sources'>[],
  igMedian: number,
): ChainChange[] {
  const shared = sharedBrandKeys(rows)
  const byPlaceId = new Map(snapshots.map((snapshot) => [snapshot.googlePlaceId, snapshot]))
  return rows.flatMap((row) => {
    if (Object.hasOwn(row.manualOverrides ?? {}, 'chain_branch')) return []
    const snapshot = row.googlePlaceId ? byPlaceId.get(row.googlePlaceId) : undefined
    if (!snapshot && !shared.has(row.id)) return []
    const official = officialBranchEvidence(snapshot?.sources ?? [], { website: row.website ?? null, instagram: row.instagram })
    const chain = shared.has(row.id) || official.length > 0
    if (chain === row.chainBranch) return []
    const evidence = shared.has(row.id) ? [`brand_key ${row.brandKey}`] : official.map((source) => source.url)
    return [{ id: row.id, name: row.name, before: { igFollowers: row.igFollowers, chainBranch: row.chainBranch, prominence: row.prominence }, after: update(row.igFollowers, chain, igMedian), evidence }]
  })
}
