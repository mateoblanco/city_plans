// Genera server/data/rambla.json (la Rambla de Montevideo como MultiLineString GeoJSON) desde OpenStreetMap, para
// calcular sea_view por distancia (server/places/sea-view.ts). Se corre sólo para regenerarlo; el JSON va commiteado.
// Uso: yarn tsx server/scripts/rambla-geojson.ts
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Los tramos frente al mar, de Ciudad Vieja sur a Carrasco, por nombre de OSM. Una lista de los que entran y no de los
 * que se sacan: hay calles que se llaman "Rambla" lejos de la costa (Euskal Erría, Concepción del Uruguay…). La rambla
 * portuaria no cuenta (25 de Agosto de 1825, Sud América, Edison, Baltasar Brum, José Pedro Cardoso): da a la bahía y
 * al puerto, no al mar.
 */
export const SEA_RAMBLA_NAMES = [
  'Rambla Francia',
  'Rambla Gran Bretaña',
  'Rambla Sur',
  'Rambla República Helénica',
  'Rambla República Argentina',
  'Rambla Wilson',
  'Rambla Mahatma Gandhi',
  'Rambla República del Perú',
  'Rambla Presidente Charles de Gaulle',
  'Rambla Armenia',
  'Rambla República de Chile',
  "Rambla O'Higgins",
  'Rambla República de México',
  'Rambla Tomás Berreta',
  'Rambla General Liber Seregni',
]

const QUERY = `[out:json][timeout:60];way["highway"]["highway"!="proposed"]["name"~"^Rambla"](-34.95,-56.45,-34.80,-55.99);out tags geom;`

type Way = { tags: { name: string }; geometry: { lat: number; lon: number }[] }

// 5 decimales: ~1 m, de sobra para un umbral de 100 m.
const round = (value: number) => Math.round(value * 1e5) / 1e5

async function main() {
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'User-Agent': 'city-plans-backoffice/1.0', Accept: 'application/json' },
    body: new URLSearchParams({ data: QUERY }),
  })
  if (!response.ok) throw new Error(`Overpass respondió ${response.status}`)
  const { elements } = (await response.json()) as { elements: Way[] }
  const ways = elements.filter((way) => SEA_RAMBLA_NAMES.includes(way.tags.name))
  const missing = SEA_RAMBLA_NAMES.filter((name) => !ways.some((way) => way.tags.name === name))
  if (missing.length) throw new Error(`Sin tramos en OSM: ${missing.join(', ')}`)
  const geojson = {
    type: 'MultiLineString',
    attribution: '© OpenStreetMap contributors, ODbL',
    names: SEA_RAMBLA_NAMES,
    coordinates: ways.map((way) => way.geometry.map((point) => [round(point.lon), round(point.lat)])),
  }
  const out = resolve(import.meta.dirname, '../data/rambla.json')
  writeFileSync(out, `${JSON.stringify(geojson)}\n`)
  console.log(`${ways.length} tramos, ${geojson.coordinates.flat().length} puntos → ${out}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
