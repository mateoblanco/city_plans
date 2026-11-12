// Genera /shared/neighborhood-polygons.json desde el GeoJSON del INE, para que la app de Next busque lugares cerca del
// borde de un barrio ("Cerca de Palermo") sin cargar el archivo entero (1,5 MB): el anillo exterior de cada barrio,
// simplificado con Douglas–Peucker (TOLERANCE_M) y con 6 decimales.
// Uso: yarn tsx server/scripts/neighborhood-polygons.ts
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import barrios from '../../src/lib/barrios.json' with { type: 'json' }

type Point = [number, number]

/** Tolerancia en metros: mucho menos que los 500 m de "Cerca de" y que una cuadra. */
const TOLERANCE_M = 5
const METERS_PER_DEGREE = 111_320

const round = (value: number) => Math.round(value * 1e6) / 1e6

/** Distancia en metros de p al segmento a–b, en una proyección local (equirectangular: alcanza para un barrio). */
function segmentDistance(p: Point, a: Point, b: Point, cosLat: number) {
  const [px, py] = [p[0] * cosLat * METERS_PER_DEGREE, p[1] * METERS_PER_DEGREE]
  const [ax, ay] = [a[0] * cosLat * METERS_PER_DEGREE, a[1] * METERS_PER_DEGREE]
  const [bx, by] = [b[0] * cosLat * METERS_PER_DEGREE, b[1] * METERS_PER_DEGREE]
  const [dx, dy] = [bx - ax, by - ay]
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Douglas–Peucker iterativo; conserva el primero y el último (el anillo sigue cerrado). */
export function simplify(points: Point[], toleranceM: number): Point[] {
  if (points.length <= 3) return points
  const cosLat = Math.cos((points[0][1] * Math.PI) / 180)
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = keep[points.length - 1] = true
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [start, end] = stack.pop()!
    let farthest = -1
    let max = 0
    for (let i = start + 1; i < end; i++) {
      const distance = segmentDistance(points[i], points[start], points[end], cosLat)
      if (distance > max) [max, farthest] = [distance, i]
    }
    if (farthest !== -1 && max > toleranceM) {
      keep[farthest] = true
      stack.push([start, farthest], [farthest, end])
    }
  }
  return points.filter((_, index) => keep[index])
}

/** Un anillo cerrado: el primero y el último iguales también en el original, así se parte en dos mitades. */
function simplifyRing(ring: Point[]): Point[] {
  const middle = Math.floor(ring.length / 2)
  const first = simplify(ring.slice(0, middle + 1), TOLERANCE_M)
  const second = simplify(ring.slice(middle), TOLERANCE_M)
  return [...first, ...second.slice(1)].map(([lng, lat]) => [round(lng), round(lat)])
}

const polygons: Record<string, Point[]> = {}
let before = 0
let after = 0
for (const feature of barrios.features) {
  const ring = feature.geometry.coordinates[0] as Point[]
  const simplified = simplifyRing(ring)
  before += ring.length
  after += simplified.length
  polygons[feature.properties.barrio] = simplified
}

const out = resolve(import.meta.dirname, '../../../shared/neighborhood-polygons.json')
writeFileSync(out, `${JSON.stringify(polygons)}\n`)
console.log(`${Object.keys(polygons).length} barrios, ${before} → ${after} vértices → ${out}`)
