import type { NewPlace } from '../db/schema.ts'
import type { PlaceEnrichmentDraft } from '../../src/types/places.ts'
import { computeProminence } from './prominence.ts'

export type PlaceRow = Omit<NewPlace, 'slug' | 'status' | 'neighborhoodId'> & { neighborhoodId: string }

export const MISSING_NAME = 'Sin nombre: ninguna fuente confirma el nombre'

/** "" o sólo espacios no es un valor: se guarda null. */
const text = (value: string | null | undefined) => value?.trim() ? value : null

/**
 * Convierte el place del pipeline en una fila de `places`, con prominence calculado desde signals.
 * Nunca incluye featured (curaduría manual). placeFacts y lo que está fuera de
 * place (review, sourceAudit, performance) no se guardan. El barrio ya tiene que estar validado.
 * Los textos vacíos pasan a null; sin nombre (NOT NULL en la tabla) tira un error.
 */
export function toRow(place: PlaceEnrichmentDraft & { neighborhoodId: string }): PlaceRow {
  const { coordinates, dietary, contact, description, signals, logo } = place
  const name = text(place.name)
  if (!name) throw new Error(MISSING_NAME)
  return {
    googlePlaceId: place.googlePlaceId,
    name,
    address: text(place.address),
    locatedIn: text(place.locatedIn),
    neighborhoodId: place.neighborhoodId,
    city: place.city,
    location: { lng: coordinates.lng, lat: coordinates.lat },
    coordinatesSource: coordinates.source,
    coordinatesFetchedAt: new Date(coordinates.fetchedAt),
    categories: place.categories,
    tags: place.tags,
    signature: place.signature,
    dishes: place.dishes,
    dietVegan: dietary.vegan,
    dietVegetarian: dietary.vegetarian,
    dietGlutenFree: dietary.glutenFree,
    price: place.price,
    reservations: place.reservations,
    hours: place.hours,
    phone: text(contact.phone),
    whatsapp: text(contact.whatsapp),
    instagram: text(contact.instagram),
    website: text(contact.website),
    menuUrl: text(contact.menuUrl),
    reservationUrl: text(contact.reservationUrl),
    descriptionEs: text(description.es),
    descriptionEn: text(description.en),
    highlights: place.highlights,
    transitLines: place.transit.lines,
    igFollowers: signals.igFollowers,
    chainBranch: signals.chainBranch,
    prominence: computeProminence(signals),
    logoKey: logo?.key ?? null,
    logoKind: logo?.kind ?? null,
    logoBgColor: logo?.bgColor ?? null,
    logoColor: logo?.color ?? null,
    logoSource: logo?.source ?? null,
    logoFetchedAt: logo ? new Date(logo.fetchedAt) : null,
    iconCategory: place.iconCategory ?? null,
    style: place.style ?? null,
    reviewReasons: place.reviewReasons ?? [],
    embeddingText: text(place.embeddingText),
    keywordText: text(place.keywordText),
  }
}
