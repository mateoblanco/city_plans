import type { ExtractionRow } from '@/hooks/use-extraction-batch'
import { ISSUE_LABELS, KIND_LABELS } from '@/lib/logo-labels'
import type { PlaceEnrichmentResponse, PlaceReview } from '@/types/places'

export const LOGO_GROUPS = [
  { id: 'with_logo', label: 'Con logo' },
  { id: 'no_candidate', label: 'Sin Instagram candidato (ni en la primera pasada ni en el respaldo)' },
  { id: 'instagram_rejected', label: 'Instagram rechazado en la validación' },
  { id: 'no_picture', label: 'Apify no trajo URL de la foto' },
  { id: 'download_failed', label: 'Error al bajar la imagen' },
  { id: 'too_small', label: 'Imagen muy chica' },
  { id: 'generic_avatar', label: 'Avatar genérico de Instagram' },
  { id: 'person_photo', label: 'Foto de una persona: sin logo' },
  { id: 'not_logo', label: 'Clasificada como local, comida u otro' },
  { id: 'failed', label: 'Error al clasificar o al subir a R2' },
] as const

export type LogoGroupId = (typeof LOGO_GROUPS)[number]['id']
export type LogoSummaryPlace = { name: string; detail: string | null }
export type LogoSummary = {
  groups: Record<LogoGroupId, LogoSummaryPlace[]>
  /** Filas con error: no llegaron al paso del logo. */
  withoutStep: number
  /** Búsqueda de respaldo del Instagram: en cuántos lugares corrió y en cuáles terminó en un Instagram validado. */
  fallback: { searched: number; found: LogoSummaryPlace[] }
}

const MISSING_NAME = 'Sin nombre confirmado'

/** Grupo y detalle del paso del logo de un lugar procesado. */
function classify(logo: PlaceReview['logo']): { group: LogoGroupId; detail: string | null } {
  if (logo.status === 'ok') {
    // Se sube igual, pero una foto del local o de comida no sirve como logo.
    return logo.kind && logo.kind !== 'logo'
      ? { group: 'not_logo', detail: KIND_LABELS[logo.kind] }
      : { group: 'with_logo', detail: null }
  }
  switch (logo.reason) {
    case 'no_picture': return { group: 'no_picture', detail: null }
    case 'download_failed': return { group: 'download_failed', detail: logo.detail ?? null }
    case 'not_image': return { group: 'download_failed', detail: logo.detail ? `no es imagen, ${logo.detail}` : 'no es imagen' }
    case 'too_small': return { group: 'too_small', detail: null }
    case 'generic_avatar': return { group: 'generic_avatar', detail: null }
    case 'person_photo': return { group: 'person_photo', detail: null }
    default: return { group: 'failed', detail: logo.reason ? ISSUE_LABELS[logo.reason] : null }
  }
}

/**
 * Sin Instagram validado: sin ningún candidato, o con candidatos que la validación rechazó
 * (cada uno con su handle y motivo; "respaldo" si lo propuso la búsqueda de respaldo).
 */
function withoutInstagram(result: PlaceEnrichmentResponse): { group: LogoGroupId; detail: string | null } {
  const candidates = result.sourceAudit?.instagramSelection.candidates ?? []
  if (candidates.length === 0) return { group: 'no_candidate', detail: null }
  const fromFallback = new Set(result.status === 'ok' ? result.review.instagramFallback?.handles ?? [] : [])
  return {
    group: 'instagram_rejected',
    detail: candidates
      .map((candidate) => `@${candidate.handle}: ${candidate.reason}${fromFallback.has(candidate.handle) ? ' (respaldo)' : ''}`)
      .join(', '),
  }
}

/** Resultado del paso del logo de cada lugar del lote, agrupado por motivo con los nombres. */
export function logoSummary(rows: readonly ExtractionRow[]): LogoSummary {
  const groups = Object.fromEntries(LOGO_GROUPS.map((group) => [group.id, []])) as unknown as LogoSummary['groups']
  let withoutStep = 0
  const fallback: LogoSummary['fallback'] = { searched: 0, found: [] }
  for (const row of rows) {
    const result = row.result
    if (row.status !== 'done' || !result) {
      if (row.status === 'error') withoutStep += 1
      continue
    }
    // Sin fuentes no hay Instagram validado: el paso del logo no tuvo foto.
    if (result.status === 'no_sources') {
      const { group, detail } = withoutInstagram(result)
      groups[group].push({ name: result.target.name, detail: detail ? `sin fuentes, ${detail}` : 'sin fuentes' })
      continue
    }
    const name = result.place.name || MISSING_NAME
    if (result.review.instagramFallback?.attempted) {
      fallback.searched += 1
      const rescued = result.review.instagramFallback.reason?.startsWith('candidato rechazado') ?? false
      if (result.sourceAudit?.instagram) fallback.found.push({ name, detail: rescued ? 'tras rechazo' : null })
    }
    if (!result.review.logo) continue
    // Sin nombre confirmado no se buscó: cuenta como sin candidato aunque la primera pasada haya rechazado alguno.
    const unsearched = result.review.instagramFallback?.skipped === 'unconfirmed_name'
    const { group, detail } = result.review.logo.reason !== 'no_instagram'
      ? classify(result.review.logo)
      : unsearched ? { group: 'no_candidate' as const, detail: 'sin búsqueda: nombre no confirmado' } : withoutInstagram(result)
    groups[group].push({ name, detail })
  }
  return { groups, withoutStep, fallback }
}
