import { montevideoNeighborhood, normalizeName } from '../../src/lib/discount-names.ts'
import { isMissingCandidate, memberKey } from '../../src/lib/discount-missing.ts'
import { getBarrio } from '../../src/lib/getNeighborhood.ts'
import type { DiscountPlace, MissingMember, MissingRow, ProviderPlaceLocation } from '../../src/types/discounts.ts'

// Vista "No están en la base": un local por fila, sin repetir entre proveedores. Se arma en el servidor (GET
// /api/discounts y la búsqueda usan la misma función, así las claves de las filas coinciden).

export { isMissingCandidate }

/** ¿Es un local de Montevideo? Con coordenadas, si caen en un barrio; sin ellas, por el departamento de la fuente. */
const inMontevideo = (location: ProviderPlaceLocation) => location.coordinates
  ? getBarrio(location.coordinates.lat, location.coordinates.lng) !== null
  : location.department === null || location.department === 'Montevideo'

/** Santander: barrio por coordenadas; BBVA: por el barrio que escribe la fuente. */
const locationNeighborhood = (location: ProviderPlaceLocation) => location.coordinates
  ? getBarrio(location.coordinates.lat, location.coordinates.lng)
  : montevideoNeighborhood(location.area)

/** Sin direcciones: el barrio de la ciudad de la fuente, sólo si nombra uno solo ("Pocitos, Montevideo"). */
function cityNeighborhood(city: string | null): string | null {
  const found = new Set((city ?? '').split(/,| y /).map((part) => montevideoNeighborhood(part)).filter((id): id is string => id !== null))
  return found.size === 1 ? [...found][0] : null
}

export function missingMembers(place: DiscountPlace): MissingMember[] {
  const base = { discountPlaceId: place.id, providerId: place.providerId, sourceName: place.sourceName, sourceUrl: place.sourceUrl }
  const local = place.locations.flatMap((location, index) => (inMontevideo(location) ? [{ location, index }] : []))
  if (local.length === 0) {
    return [{ ...base, key: memberKey(place.id, null), locationIndex: null, neighborhoodId: cityNeighborhood(place.city), address: null, coordinates: null }]
  }
  return local.map(({ location, index }) => ({
    ...base,
    key: memberKey(place.id, index),
    locationIndex: index,
    neighborhoodId: locationNeighborhood(location),
    address: location.address || null,
    coordinates: location.coordinates ?? null,
  }))
}

/** El nombre más repetido entre los locales (a igualdad, el primero). */
function displayName(members: MissingMember[]): string {
  const counts = new Map<string, number>()
  for (const member of members) counts.set(member.sourceName, (counts.get(member.sourceName) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])[0][0]
}

function rowOf(owners: MissingMember[], extra: MissingMember[]): MissingRow {
  const members = [...owners, ...extra]
  const located = owners.find((member) => member.coordinates) ?? null
  const addressed = owners.find((member) => member.address) ?? null
  return {
    key: owners.map((member) => member.key).sort().join('|'),
    name: displayName(owners),
    normalized: normalizeName(owners[0].sourceName),
    neighborhoodId: owners[0].neighborhoodId,
    members,
    owners,
    providerIds: [...new Set(members.map((member) => member.providerId))].sort(),
    coordinates: located?.coordinates ?? null,
    address: (located ?? addressed)?.address ?? null,
  }
}

/**
 * Filas sin repetir. Dos locales son la misma fila si su nombre normalizado (normalizeName: sin tildes, puntuación ni
 * palabras genéricas) es igual y, si los dos tienen barrio, es el mismo. Un local sin barrio (Itaú) se suma a todas las
 * filas con barrio de ese nombre; si no hay ninguna, va a "Sin barrio" (junto con los otros sin barrio de ese nombre).
 */
export function missingRows(places: DiscountPlace[]): MissingRow[] {
  const members = places.filter(isMissingCandidate).flatMap(missingMembers)
  const zoned = new Map<string, MissingMember[]>()
  const unzoned = new Map<string, MissingMember[]>()
  for (const member of members) {
    const name = normalizeName(member.sourceName)
    // Un nombre que no deja nada para comparar no se junta con nadie.
    const id = name || `#${member.key}`
    if (member.neighborhoodId) zoned.set(`${id}|${member.neighborhoodId}`, [...(zoned.get(`${id}|${member.neighborhoodId}`) ?? []), member])
    else unzoned.set(id, [...(unzoned.get(id) ?? []), member])
  }
  const zonedNames = new Set([...zoned.keys()].map((key) => key.slice(0, key.lastIndexOf('|'))))
  const rows = [...zoned].map(([key, owners]) => rowOf(owners, unzoned.get(key.slice(0, key.lastIndexOf('|'))) ?? []))
  for (const [name, owners] of unzoned) if (!zonedNames.has(name)) rows.push(rowOf(owners, []))
  return rows
}
