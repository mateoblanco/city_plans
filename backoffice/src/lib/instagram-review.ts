import { parseInstagramHandle } from '@/lib/instagram-handle'
import type { InstagramChoice, InstagramDiscovery } from '@/types/places'

/** Lo que se cargó en la revisión de un lugar: el texto del input y "No tiene Instagram". */
export type ReviewDraft = { text: string; none: boolean }

/**
 * Cómo arranca la revisión: con lo cargado a mano en un procesamiento anterior, o con el Instagram aprobado. Un
 * dudoso arranca vacío ("Usar este" lo copia).
 */
export function initialDraft(discovery: InstagramDiscovery): ReviewDraft {
  if (discovery.saved) return { text: discovery.saved.handle ?? '', none: discovery.saved.handle === null }
  return { text: discovery.status === 'approved' ? discovery.handle ?? '' : '', none: false }
}

/**
 * Instagram con el que sigue el paso 2. none: marcado "No tiene Instagram". auto: el input vacío o con el aprobado por
 * la validación. manual: cualquier otro handle (también un dudoso copiado con "Usar este"). invalid: el input no es un
 * perfil de Instagram.
 */
export function instagramChoiceFor(discovery: InstagramDiscovery, draft: ReviewDraft): InstagramChoice | 'invalid' {
  if (draft.none) return { mode: 'none' }
  if (!draft.text.trim()) return { mode: 'auto' }
  const handle = parseInstagramHandle(draft.text)
  if (!handle) return 'invalid'
  if (discovery.status === 'approved' && handle === discovery.handle) return { mode: 'auto' }
  return { mode: 'manual', handle }
}

const STATUS_ORDER: Record<InstagramDiscovery['status'], number> = { none: 0, doubtful: 1, approved: 2 }

/** Orden de la revisión: primero los que tienen un error del handle, después sin Instagram, dudosos y aprobados. */
export function reviewRank(discovery: InstagramDiscovery, instagramError: string | undefined): number {
  return instagramError ? -1 : STATUS_ORDER[discovery.status]
}
