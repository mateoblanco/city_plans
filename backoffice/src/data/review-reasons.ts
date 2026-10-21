// Motivos por los que un lugar procesado se guarda con status "review" en vez de "published".
// Se guardan en places.review_reasons (sólo los códigos; el check de la base admite estos).
export const REVIEW_REASONS = {
  not_open_yet: 'Todavía no abrió',
  no_place_facts: 'Sin datos del local: las fuentes eran de otros lugares',
  unconfirmed_place: 'Local no confirmado: las fuentes pueden ser de otro local o sucursal',
  restaurant_without_food: 'Restaurante sin comidas',
  bar_without_drinks: 'Bar sin bebidas',
} as const

export type ReviewReason = keyof typeof REVIEW_REASONS
export const REVIEW_REASON_IDS = Object.keys(REVIEW_REASONS) as [ReviewReason, ...ReviewReason[]]

export function reviewReasonLabel(id: string) {
  return Object.hasOwn(REVIEW_REASONS, id) ? REVIEW_REASONS[id as ReviewReason] : id
}

// Cerrados según Google en el barrido (businessStatus en ese momento; no se guarda).
export const CLOSED_REASONS = {
  closed_permanently: 'Cerrado definitivamente según Google',
  closed_temporarily: 'Cerrado temporalmente según Google',
} as const

export type ClosedReason = keyof typeof CLOSED_REASONS

export function isClosedReason(reason: string | null | undefined): reason is ClosedReason {
  return Boolean(reason) && Object.hasOwn(CLOSED_REASONS, reason as string)
}
