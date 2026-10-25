/**
 * Link de Google Maps de un lugar: con el googlePlaceId abre la ficha exacta y la dirección queda como consulta (la
 * API de URLs la exige); sin googlePlaceId busca la dirección. null si no hay ninguna de las dos.
 */
export function googleMapsUrl({ address, googlePlaceId, name }: { address: string | null; googlePlaceId: string | null; name: string }) {
  const query = address ?? (googlePlaceId ? name : null)
  if (!query) return null
  const params = new URLSearchParams({ api: '1', query })
  if (googlePlaceId) params.set('query_place_id', googlePlaceId)
  return `https://www.google.com/maps/search/?${params}`
}
