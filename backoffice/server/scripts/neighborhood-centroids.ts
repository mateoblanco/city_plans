// Genera /shared/neighborhood-centroids.json desde el GeoJSON del INE, para que la app de Next
// pueda ordenar por distancia al centro de un barrio sin cargar los polígonos.
// Uso: yarn tsx server/scripts/neighborhood-centroids.ts
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import barrios from '../../src/lib/barrios.json' with { type: 'json' }

type Ring = number[][]

/** Centroide por área del anillo exterior (fórmula del polígono, en grados: alcanza para un barrio). */
export function ringCentroid(ring: Ring) {
  let area = 0
  let x = 0
  let y = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i]
    const [x1, y1] = ring[i + 1]
    const cross = x0 * y1 - x1 * y0
    area += cross
    x += (x0 + x1) * cross
    y += (y0 + y1) * cross
  }
  area /= 2
  return { lng: x / (6 * area), lat: y / (6 * area) }
}

const round = (value: number) => Math.round(value * 1e6) / 1e6

const centroids: Record<string, { lat: number; lng: number }> = {}
for (const feature of barrios.features) {
  const { lat, lng } = ringCentroid(feature.geometry.coordinates[0] as Ring)
  centroids[feature.properties.barrio] = { lat: round(lat), lng: round(lng) }
}

const out = resolve(import.meta.dirname, '../../../shared/neighborhood-centroids.json')
writeFileSync(out, `${JSON.stringify(centroids, null, 2)}\n`)
console.log(`${Object.keys(centroids).length} barrios → ${out}`)
