import type { ExtractionSnapshot } from '../providers/extraction-snapshots.ts'
import { EXA_SUMMARY_URL, FOREIGN_TLDS, MENTIONS_URUGUAY, SITE_BUILDER_HOSTS, canonical, hostedBy, hostname } from '../providers/source-hosts.ts'
import { websiteRejection, websiteRejectionLabel } from '../providers/website-check.ts'
import { recomputeChains, type ChainChange, type SignalsRow } from './refresh-signals.ts'

export type WebsiteRow = SignalsRow & { neighborhoodId: string; website: string | null }

export type WebsiteVerdict = {
  id: string
  name: string
  neighborhoodId: string
  website: string
  /** drop: la regla la descarta. doubtful: la regla la deja, o no puede decidir; la decide una persona. */
  kind: 'drop' | 'doubtful'
  reason: string
  /** chain_branch y prominence si la web queda en null; null si no cambian. */
  chain: ChainChange | null
}

// Ciudades del interior en el dominio (misushipunta.com): puede ser la web de otra sucursal. Punta Carretas y Punta
// Gorda son barrios de Montevideo.
const OTHER_CITY_IN_HOST = /punta(?!carretas|gorda)|piriapolis|joseignacio|lapaloma|atlantida|carmelo|paysandu|tacuarembo|chuy/

/** Texto de la web guardada en el snapshot: las fuentes de su mismo host (sin el resumen de Exa). */
function websiteTexts(website: string, snapshot: Pick<ExtractionSnapshot, 'sources'> | undefined): string[] {
  const host = hostname(website)
  return (snapshot?.sources ?? []).filter((source) => source.url !== EXA_SUMMARY_URL && hostname(source.url) === host).map((source) => source.text)
}

/** Por qué una web que la regla acepta igual conviene revisarla a mano; null si no hay motivo. */
function doubtfulReason(website: string, texts: string[]): string | null {
  const host = hostname(website) ?? ''
  const tld = host.split('.').at(-1) ?? ''
  const foreignTld = FOREIGN_TLDS.has(tld) || tld === 'co'
  if (foreignTld && hostedBy(website, SITE_BUILDER_HOSTS)) return `constructor de sitios con dominio .${tld}: el dominio es de la plataforma`
  if (foreignTld && MENTIONS_URUGUAY.test(canonical(texts.join('\n')))) return `dominio .${tld}, pero la web menciona Montevideo o Uruguay`
  const city = canonical(host).replace(/[^a-z0-9]/g, '').match(OTHER_CITY_IN_HOST)
  if (city) return `el dominio nombra otra ciudad (${city[0]}): puede ser la web de otra sucursal`
  return null
}

/**
 * Revisa las webs guardadas con la regla del pipeline (`websiteRejection`), con el texto del snapshot. No toca las que
 * tienen la web editada a mano. Un dominio de otro país sin texto de la web en el snapshot queda dudoso: no se puede ver
 * si menciona Uruguay. Para cada una, cómo quedaría chain_branch con la web en null (`recomputeChains`).
 */
export function checkSavedWebsites(rows: WebsiteRow[], snapshots: Pick<ExtractionSnapshot, 'googlePlaceId' | 'sources'>[], igMedian: number): WebsiteVerdict[] {
  const byPlaceId = new Map(snapshots.map((snapshot) => [snapshot.googlePlaceId, snapshot]))
  const verdicts = rows.flatMap((row): Omit<WebsiteVerdict, 'chain'>[] => {
    if (!row.website || Object.hasOwn(row.manualOverrides ?? {}, 'website')) return []
    const texts = websiteTexts(row.website, row.googlePlaceId ? byPlaceId.get(row.googlePlaceId) : undefined)
    const base = { id: row.id, name: row.name, neighborhoodId: row.neighborhoodId, website: row.website }
    const rejection = websiteRejection(row.website, texts)
    if (rejection?.reason === 'foreign_domain' && texts.length === 0) {
      return [{ ...base, kind: 'doubtful', reason: `${websiteRejectionLabel(rejection)}, sin texto de la web en el snapshot para ver si menciona Uruguay` }]
    }
    if (rejection) return [{ ...base, kind: 'drop', reason: websiteRejectionLabel(rejection) }]
    const doubtful = doubtfulReason(row.website, texts)
    return doubtful ? [{ ...base, kind: 'doubtful', reason: doubtful }] : []
  })
  const flagged = new Set(verdicts.map((verdict) => verdict.id))
  const chains = new Map(recomputeChains(rows.map((row) => flagged.has(row.id) ? { ...row, website: null } : row), snapshots, igMedian)
    .map((change) => [change.id, change]))
  return verdicts.map((verdict) => ({ ...verdict, chain: chains.get(verdict.id) ?? null }))
}
