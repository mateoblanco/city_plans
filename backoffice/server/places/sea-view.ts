import { sql, type SQL } from 'drizzle-orm'
import rambla from '../data/rambla.json' with { type: 'json' }

/**
 * sea_view sale de la ubicación, no del modelo: lo tiene un lugar a menos de SEA_VIEW_METERS de la Rambla (los tramos
 * frente al mar de server/data/rambla.json, de OSM; sin la rambla portuaria). Los overrides manuales van después
 * (applyOverrides): uno sacado a mano no vuelve y uno agregado a mano se queda.
 */
export const SEA_VIEW_METERS = 100

// Sólo type y coordinates: los demás campos del archivo (atribución, nombres) no son GeoJSON.
const RAMBLA_GEOJSON = JSON.stringify({ type: rambla.type, coordinates: rambla.coordinates })

/** La Rambla como geography de PostGIS. */
export const ramblaGeography = (): SQL => sql`ST_GeomFromGeoJSON(${RAMBLA_GEOJSON})::geography`

export const isSeaView = (id: string): id is 'sea_view' => id === 'sea_view'

/** Los tags con sea_view sólo si el lugar está cerca de la Rambla: el que puso el modelo no cuenta. */
export function withSeaView<T extends string>(tags: readonly T[], near: boolean): T[] {
  const rest = tags.filter((id) => !isSeaView(id))
  return near ? [...rest, 'sea_view' as T] : rest
}
