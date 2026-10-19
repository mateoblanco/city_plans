import pMap from 'p-map'
import type { ExaPlaceResponse } from '../../src/types/places.ts'
import type { InstagramProfileData } from '../providers/apify-instagram-provider.ts'
import { brandSearchTerm } from '../providers/brand-name.ts'
import { isChainBranch, isForeignSource, type Source } from '../providers/place-extraction-service.ts'
import { withServiceLimit } from '../providers/service-limits.ts'
import { canonical } from '../providers/source-hosts.ts'
import { computeProminence, type ProminenceSignals } from './prominence.ts'

const REFRESH_CONCURRENCY = 4

/** Lo que signals:refresh lee de cada lugar guardado. */
export type SignalsRow = ProminenceSignals & {
  id: string
  googlePlaceId: string | null
  name: string
  instagram: string | null
  prominence: number
}

export type SignalsUpdate = ProminenceSignals & { prominence: number }

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
  return left.igFollowers === right.igFollowers && Math.abs(left.prominence - right.prominence) < 1e-6
}

/**
 * Vuelve a leer los seguidores de Instagram de lugares guardados y recalcula prominence, sin LLM.
 * Exa (con la marca y el tipo de lugar de Google) sólo sirve para saber si es una sucursal de cadena:
 * ahí los seguidores son de la marca y quedan en null. No toca ninguna otra columna. Una falla de un
 * lugar no corta el resto; si falla sólo Instagram, los seguidores quedan como estaban.
 * Sin el nombre de Google, es cadena si las fuentes muestran varias sucursales o si hay más de un
 * lugar guardado con la misma marca.
 */
export async function refreshSignals(rows: SignalsRow[], deps: RefreshDeps, options: { onlyIds?: ReadonlySet<string> } = {}): Promise<RefreshResult[]> {
  // Las marcas repetidas se cuentan sobre todos los lugares, aunque se procesen sólo algunos.
  const brandCounts = new Map<string, number>()
  for (const row of rows) brandCounts.set(brandKey(row.name), (brandCounts.get(brandKey(row.name)) ?? 0) + 1)
  const selected = options.onlyIds ? rows.filter((row) => options.onlyIds!.has(row.id)) : rows

  return pMap(selected, async (row): Promise<RefreshResult> => {
    const before: SignalsUpdate = { igFollowers: row.igFollowers, prominence: row.prominence }
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
    const chain = (brandCounts.get(brandKey(row.name)) ?? 0) > 1 || isChainBranch({ name: row.name }, sources)

    let igFollowers: number | null = null
    if (!chain && row.instagram) {
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

    const after: SignalsUpdate = { igFollowers, prominence: computeProminence({ igFollowers }) }
    const result = { ...base, after, chain, warnings }
    if (sameSignals(before, after)) return { ...result, status: 'unchanged' }
    if (deps.write) {
      try {
        await deps.write(row.id, after)
      } catch (error) {
        return { ...result, status: 'error', error: `No se pudo guardar: ${message(error)}` }
      }
    }
    return { ...result, status: 'changed' }
  }, { concurrency: REFRESH_CONCURRENCY })
}
