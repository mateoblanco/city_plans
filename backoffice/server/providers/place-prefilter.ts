import type { PlaceGroup } from '../../src/types/places.ts'
import {
  ACCEPT_PRIMARY_TYPES,
  ACCEPT_PRIMARY_TYPE_SUFFIXES,
  MIN_REVIEWS_TO_ACCEPT,
  REJECT_PRIMARY_TYPES,
  CLOSED_BUSINESS_STATUSES,
  REVIEW_PRIMARY_TYPES,
} from './neighborhood-sweep-config.ts'

export type PlaceClassification = {
  group: PlaceGroup
  reason: string | null
}

export const UNKNOWN_TYPE_PREFIX = 'unknown_type:'

/**
 * Clasifica con businessStatus, primaryType y cantidad de reseñas. El rating no interviene.
 * Un lugar sin userRatingCount se considera sin reseñas.
 */
export function classifyPlace(place: {
  businessStatus?: string
  primaryType?: string
  userRatingCount?: number
}): PlaceClassification {
  // Cerrado según Google: a revisión con el motivo; la UI no deja procesarlo salvo que se mueva a mano.
  if (place.businessStatus && CLOSED_BUSINESS_STATUSES.includes(place.businessStatus)) {
    return { group: 'review', reason: place.businessStatus.toLowerCase() }
  }

  const primaryType = place.primaryType
  if (!primaryType) return { group: 'review', reason: 'primary_type_missing' }
  if (REJECT_PRIMARY_TYPES.includes(primaryType)) {
    return { group: 'rejected', reason: `excluded_type:${primaryType}` }
  }

  if (REVIEW_PRIMARY_TYPES.includes(primaryType)) {
    return { group: 'review', reason: `review_type:${primaryType}` }
  }

  const accepted =
    ACCEPT_PRIMARY_TYPES.includes(primaryType) ||
    ACCEPT_PRIMARY_TYPE_SUFFIXES.some((suffix) => primaryType.endsWith(suffix))
  if (!accepted) return { group: 'review', reason: `${UNKNOWN_TYPE_PREFIX}${primaryType}` }
  if ((place.userRatingCount ?? 0) < MIN_REVIEWS_TO_ACCEPT) return { group: 'review', reason: 'few_reviews' }
  return { group: 'accepted', reason: null }
}
