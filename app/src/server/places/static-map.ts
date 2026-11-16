import 'server-only'
import { createHmac } from 'node:crypto'
import type { IconCategory } from '@shared/icon-categories.ts'
import { MARKER_ICONS } from '@/components/pages/SearchPage/Results/Map/SearchMap/marker-icons'
import { PLACE_MAP_ZOOM } from '@/lib/place-map'
import { siteUrl } from '../seo/indexing'

type Env = Record<string, string | undefined>

const ENDPOINT = 'https://maps.googleapis.com/maps/api/staticmap'

/** El máximo de Static Maps por lado (con scale=2 vuelve el doble de píxeles). */
const MAX_SIDE = 640

/**
 * Lo que el recuadro del mapa tiene menos que la pantalla en mobile: 16px de gutter, 24px de padding y 1px de borde de
 * la tarjeta (.main de PlacePage) a cada lado. El recuadro es 16:10 (PlaceMap.module.scss).
 */
export const STATIC_MAP_INSET = 82

/**
 * Tramos de ancho de pantalla: cada uno tiene su imagen del tamaño de su recuadro (el `<source media>` de StaticMap
 * elige uno sin JS). Dentro de un tramo la imagen se estira como mucho ~3 % en teléfonos; desde 722px el recuadro pasa
 * de 640px y se usa la de 640.
 */
export const STATIC_MAP_BREAKPOINTS = [320, 340, 360, 375, 390, 400, 412, 430, 480, 540, 600, 680, 722] as const

export type StaticMapSource = {
  /** Ancho de pantalla desde el que vale (min-width). */
  minViewport: number
  width: number
  height: number
  url: string
}

/** El secreto de firma de Google viene en base64 "URL-safe" (- y _). */
const decodeSecret = (secret: string) => Buffer.from(secret.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

/**
 * Firma una URL de Google Maps Platform: HMAC-SHA1 de la ruta y la query (sin el host) con el secreto, en base64
 * URL-safe, como `signature`. Lo que se firma es el texto exacto que se pide: después de firmar no se puede tocar.
 */
export function signMapsUrl(url: string, secret: string): string {
  const parsed = new URL(url)
  const signature = createHmac('sha1', decodeSecret(secret))
    .update(parsed.pathname + parsed.search)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
  return `${url}&signature=${signature}`
}

/**
 * Desde dónde baja Google el PNG del marcador (public/map-markers/). Tiene que ser público: en producción, el sitio
 * (SITE_URL); en un preview de Vercel, el propio deploy (si el preview tiene protección, Google no lo puede bajar y la
 * imagen sale sin marcador). En local (localhost) Google no llega: sale sin marcador.
 */
export function markerIconBase(env: Env = process.env): string {
  const preview = env.VERCEL_ENV === 'preview' ? (env.VERCEL_BRANCH_URL ?? env.VERCEL_URL)?.trim() : undefined
  return preview ? `https://${preview}` : siteUrl(env)
}

/** El PNG del ícono de la categoría; sin categoría o sin ícono, el genérico. */
export function markerIconFile(category: IconCategory | null): string {
  return category && category in MARKER_ICONS ? `${category}.png` : 'default.png'
}

type MapInput = { lat: number; lng: number; iconCategory: IconCategory | null }

/** La URL sin firmar de una imagen de `width`×`height` (px CSS; con scale=2 vuelve al doble). */
export function staticMapUrl(input: MapInput & { width: number; height: number }, env: Env = process.env): string | null {
  const key = env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim()
  if (!key) return null
  const point = `${input.lat.toFixed(6)},${input.lng.toFixed(6)}`
  const params = new URLSearchParams({
    center: point,
    zoom: String(PLACE_MAP_ZOOM),
    size: `${input.width}x${input.height}`,
    scale: '2',
    language: 'es',
    region: 'UY',
  })
  const mapId = env.NEXT_PUBLIC_GOOGLE_MAP_ID?.trim()
  if (mapId) params.set('map_id', mapId)
  // scale:2 en el marcador: el PNG está al doble (como el mapa), así se ve nítido y del tamaño en CSS.
  params.set('markers', `anchor:center|scale:2|icon:${markerIconBase(env)}/map-markers/${markerIconFile(input.iconCategory)}|${point}`)
  params.set('key', key)
  return `${ENDPOINT}?${params}`
}

/**
 * Una imagen firmada por tramo de ancho de pantalla (STATIC_MAP_BREAKPOINTS), para el <picture> de la ficha en mobile.
 * Google no se llama acá: la imagen la pide el navegador directo a Google, nunca pasa por nuestro servidor ni se guarda.
 * [] sin la clave del mapa o sin GOOGLE_MAPS_SIGNING_SECRET (queda el recuadro liso).
 */
export function staticMapSources(input: MapInput, env: Env = process.env): StaticMapSource[] {
  const secret = env.GOOGLE_MAPS_SIGNING_SECRET?.trim()
  if (!secret) {
    console.warn('staticMapSources: falta GOOGLE_MAPS_SIGNING_SECRET; la ficha en mobile va sin mapa.')
    return []
  }
  const sources: StaticMapSource[] = []
  for (const minViewport of STATIC_MAP_BREAKPOINTS) {
    const width = Math.min(MAX_SIDE, minViewport - STATIC_MAP_INSET)
    const height = Math.round((width * 10) / 16)
    const url = staticMapUrl({ ...input, width, height }, env)
    if (!url) return []
    sources.push({ minViewport, width, height, url: signMapsUrl(url, secret) })
  }
  return sources
}
