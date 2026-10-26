/**
 * Link de Google Maps de un lugar: con el googlePlaceId abre la ficha exacta y el nombre queda como consulta (la API
 * de URLs la exige). null sin googlePlaceId.
 */
export function googleMapsUrl({ googlePlaceId, name }: { googlePlaceId: string | null; name: string }) {
  if (!googlePlaceId) return null
  const params = new URLSearchParams({ api: '1', query: name, query_place_id: googlePlaceId })
  return `https://www.google.com/maps/search/?${params}`
}
