// Motivos por los que un lugar procesado se guarda con status "review" en vez de "published".
// Se guardan en places.review_reasons (sólo los códigos; el check de la base admite estos).
export const REVIEW_REASONS = {
  not_open_yet: 'Todavía no abrió',
  no_place_facts: 'Sin datos del local: las fuentes eran de otros lugares',
  unconfirmed_place: 'Local no confirmado: las fuentes pueden ser de otro local o sucursal',
  restaurant_without_food: 'Restaurante sin comidas',
  bar_without_drinks: 'Bar sin bebidas',
  low_rating: 'Puntaje bajo en Google',
  closed_permanently: 'Cerrado definitivamente',
  closed_temporarily: 'Cerrado temporalmente',
  // Lo agregó la búsqueda de Descuentos › "No están en la base": siempre se revisa a mano antes de publicar.
  from_discounts: 'Agregado desde descuentos',
} as const

export type ReviewReason = keyof typeof REVIEW_REASONS
export const REVIEW_REASON_IDS = Object.keys(REVIEW_REASONS) as [ReviewReason, ...ReviewReason[]]

export function reviewReasonLabel(id: string) {
  return Object.hasOwn(REVIEW_REASONS, id) ? REVIEW_REASONS[id as ReviewReason] : id
}

// Cerrados según el businessStatus de Google (barrido, Place Details de /api/extract y places:check-status).
// Sólo se guarda el código del motivo, nunca el dato de Google.
export const CLOSED_REASONS = {
  closed_permanently: REVIEW_REASONS.closed_permanently,
  closed_temporarily: REVIEW_REASONS.closed_temporarily,
} as const

export type ClosedReason = keyof typeof CLOSED_REASONS

export function isClosedReason(reason: string | null | undefined): reason is ClosedReason {
  return Boolean(reason) && Object.hasOwn(CLOSED_REASONS, reason as string)
}

/** Motivo de un businessStatus de Google; null si está abierto o no hay dato. */
export function closedReasonOf(businessStatus: string | null | undefined): ClosedReason | null {
  if (businessStatus === 'CLOSED_PERMANENTLY') return 'closed_permanently'
  if (businessStatus === 'CLOSED_TEMPORARILY') return 'closed_temporarily'
  return null
}

// Motivo low_rating: puntaje menor a LOW_RATING_BELOW con al menos LOW_RATING_MIN_REVIEWS reseñas. Es el mismo corte
// que few_reviews en el barrido (MIN_REVIEWS_TO_ACCEPT), así no queda hueco. El filtro "Puntaje mayor a…" del barrido
// oculta exactamente estos.
export const LOW_RATING_BELOW = 3.9
export const LOW_RATING_MIN_REVIEWS = 10

/** Puntaje bajo con reseñas suficientes para creerle. Sin puntaje, o con pocas reseñas, no cuenta. */
export function isLowRating(rating: { rating: number | null; userRatingCount: number | null } | null | undefined) {
  if (!rating || rating.rating === null || rating.userRatingCount === null) return false
  return rating.rating < LOW_RATING_BELOW && rating.userRatingCount >= LOW_RATING_MIN_REVIEWS
}
