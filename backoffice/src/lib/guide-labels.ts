import { INTENTS } from '../../../shared/intents.ts'
import { GUIDE_GROUPS, type GuideGroup, type GuideStatus } from '@/data/guides'
import { neighborhoodDisplayName } from '@/data/neighborhood-names'
import type { GuideWarning } from '@/types/guides'

/** "Comer", "Tomar algo", "Cafés", "Postres": las etiquetas de la app (INTENTS). */
export const groupLabel = (group: GuideGroup) => INTENTS[group].label.es

export const GROUP_OPTIONS = GUIDE_GROUPS.map((group) => ({ value: group, label: groupLabel(group) }))

export const STATUS_LABELS: Record<GuideStatus, string> = { draft: 'Borrador', published: 'Publicada' }

/** "Montevideo · Cordón" o "Montevideo · Toda la ciudad". */
export const guideScope = (neighborhoodId: string | null) => `Montevideo · ${neighborhoodId ? (neighborhoodDisplayName(neighborhoodId) ?? neighborhoodId) : 'Toda la ciudad'}`

export function warningLabel(warning: GuideWarning): string {
  if (warning.code === 'stale') return `${warning.months} meses sin actualizar`
  return `${warning.places.length === 1 ? 'Lugar despublicado' : 'Lugares despublicados'}: ${warning.places.join(', ')}`
}

/** "19 nov 2026", en Montevideo. */
export const formatGuideDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('es-UY', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Montevideo' }) : '—'
