import type { DiscountPlace, MissingRow } from '@/types/discounts'
import { montevideoNeighborhood } from './discount-names'

// Panel «Resolver» de la pantalla Descuentos: lo que se sabe del lugar del banco que no cruzó o quedó dudoso.

/** Lo que se sabe del lugar del banco (una fila de "No están en la base" o un lugar de la tabla). */
export type ResolveTarget = {
  /** La clave de la fila (vista "No están en la base") o el id del lugar del proveedor. */
  key: string
  discountPlaceIds: string[]
  name: string
  address: string | null
  coordinates: { lat: number; lng: number } | null
  neighborhoodId: string | null
  providerIds: string[]
  sourceUrl: string
  instagram: string | null
  /** Sólo en "No están en la base": la búsqueda en Google es por fila. */
  rowKey: string | null
  /** Candidatos del cruce (un dudoso): van primero en las sugerencias. */
  candidateIds: string[]
}

/** Cómo se resolvió (cierra el panel y pasa a la siguiente fila). Vincular deja el panel abierto, por las sucursales. */
export type ResolveOutcome = 'discarded' | 'none' | 'added'

export function targetFromRow(row: MissingRow, places: DiscountPlace[]): ResolveTarget {
  const ids = [...new Set(row.members.map((member) => member.discountPlaceId))]
  const own = places.filter((place) => ids.includes(place.id))
  return {
    key: row.key,
    discountPlaceIds: ids,
    name: row.name,
    address: row.address,
    coordinates: row.coordinates,
    neighborhoodId: row.neighborhoodId,
    providerIds: row.providerIds,
    sourceUrl: row.owners[0].sourceUrl,
    instagram: own.find((place) => place.instagram)?.instagram ?? null,
    rowKey: row.key,
    candidateIds: own.flatMap((place) => place.match.candidates.map((candidate) => candidate.placeId)),
  }
}

export function targetFromPlace(place: DiscountPlace): ResolveTarget {
  const located = place.locations.find((location) => location.coordinates) ?? place.locations[0] ?? null
  return {
    key: place.id,
    discountPlaceIds: [place.id],
    name: place.sourceName,
    address: located?.address || null,
    coordinates: located?.coordinates ?? null,
    neighborhoodId: montevideoNeighborhood(located?.area ?? null) ?? montevideoNeighborhood(place.city),
    providerIds: [place.providerId],
    sourceUrl: place.sourceUrl,
    instagram: place.instagram,
    rowKey: null,
    candidateIds: place.match.candidates.map((candidate) => candidate.placeId),
  }
}
