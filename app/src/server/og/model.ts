import { createHash } from 'node:crypto'
import { isNearWhite } from '@/components/pages/PlacePage/utils/summary'

/**
 * Imagen para compartir (Open Graph, 1200 × 630, JPEG): la banda de la ficha arriba y el logo en un recuadro centrado que pisa
 * la banda y el blanco. Medidas del diseño, tal cual. Todo lo que decide qué se dibuja está acá (puro, con tests); el JSX
 * está en frame.tsx.
 */
export const OG_SIZE = { width: 1200, height: 630 } as const
/** Si cambia el diseño, subirla: cambia la URL de todas las imágenes y la CDN no sirve las viejas. */
export const OG_DESIGN_VERSION = 1

export const OG_LAYOUT = {
  /** ~60 % del alto. */
  bandHeight: 378,
  box: 470,
  border: 20,
  /** Radio de afuera; el de adentro queda en radius − border = 30. */
  radius: 50,
  /** Lado máximo del logo: la misma proporción logo/recuadro que PlaceImage lg desde ml (100 de 118). */
  logoMax: Math.round(((470 - 2 * 20) * 100) / 118),
  /** Ancho útil del nombre dentro del recuadro (430 menos 24 de cada lado). */
  nameWidth: 470 - 2 * 20 - 2 * 24,
} as const

/** Los mismos valores que los tokens de la app (`_palette.scss` / `_tokens.scss`). */
export const OG_COLORS = {
  brand: '#0469f8', // blue-500
  surface: '#ffffff', // --color-surface
  border: '#e4e4e7', // --color-border (gray-175)
  text: '#000000', // --color-text
  /** Banda de un logo sin color en la base (el azul queda para los lugares sin logo). */
  neutralBand: '#000000', // black
} as const

const HEX = /^#[0-9a-f]{6}$/i

export type PlaceOgInput = { name: string; logoKey: string | null; logoUrl: string | null; logoBgColor: string | null }

export type PlaceOgModel = {
  kind: 'logo' | 'name'
  bandColor: string
  /** Fondo del interior del recuadro (el del logo, como PlaceImage). */
  boxColor: string
  borderColor: string
  name: string
  logoUrl: string | null
}

/** Banda casi blanca → borde gris, como `onLightBar` en la ficha; si no, blanco. */
const borderOn = (band: string) => (isNearWhite(band) ? OG_COLORS.border : OG_COLORS.surface)

/**
 * Con logo, la banda y el fondo del recuadro son `logo_bg_color` (el mismo dato que PlaceHeader); sin color válido, banda
 * negra y recuadro blanco. Sin logo (o si el logo no cargó: `withLogo` false), banda de la marca y el nombre.
 */
export function placeOgModel(place: PlaceOgInput, withLogo = true): PlaceOgModel {
  const color = place.logoBgColor && HEX.test(place.logoBgColor) ? place.logoBgColor : null
  if (place.logoUrl && withLogo) {
    const band = color ?? OG_COLORS.neutralBand
    return { kind: 'logo', bandColor: band, boxColor: color ?? OG_COLORS.surface, borderColor: borderOn(band), name: place.name, logoUrl: place.logoUrl }
  }
  return { kind: 'name', bandColor: OG_COLORS.brand, boxColor: OG_COLORS.surface, borderColor: borderOn(OG_COLORS.brand), name: place.name, logoUrl: null }
}

/** Versión de la imagen (va en la URL): sólo cambia con el logo, el color, el nombre o el diseño. */
export function placeOgVersion(place: Pick<PlaceOgInput, 'name' | 'logoKey' | 'logoBgColor'>): string {
  const source = [OG_DESIGN_VERSION, place.logoKey ?? '', place.logoBgColor ?? '', place.name].join('|')
  return createHash('sha1').update(source).digest('hex').slice(0, 8)
}

export const placeOgAlt = (name: string) => `Logo de ${name}`

/**
 * La imagen de una ficha para su metadata: la URL es relativa (la hace absoluta `metadataBase`, el dominio principal) y
 * lleva la versión, así cambia sólo cuando cambia la imagen.
 */
export function placeOgImage(place: { slug: string; name: string; logoKey: string | null; logoBgColor: string | null }) {
  return {
    url: `/place/${place.slug}/og/${placeOgVersion(place)}`,
    width: OG_SIZE.width,
    height: OG_SIZE.height,
    alt: placeOgAlt(place.name),
    type: 'image/jpeg',
  }
}

/** Tamaños del nombre, del más grande al más chico, y cuánto ocupa un carácter (en em) de Switzer 600, con margen. */
const NAME_SIZES = [72, 60, 50, 42, 36] as const
const CHAR_EM = 0.55
const MAX_LINES = 3

const charsPerLine = (fontSize: number) => Math.floor(OG_LAYOUT.nameWidth / (fontSize * CHAR_EM))

/** Reparte las palabras en líneas de hasta `max` caracteres; una palabra más larga se corta. */
function wrap(words: string[], max: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of words.flatMap((w) => (w.length > max ? (w.match(new RegExp(`.{1,${max}}`, 'gu')) ?? [w]) : [w]))) {
    if (!line) line = word
    else if (line.length + 1 + word.length <= max) line += ` ${word}`
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}

/**
 * El nombre grande y centrado: el tamaño más grande en el que entra en 3 líneas sin cortar palabras; si no entra ni en
 * el más chico, 3 líneas y la última termina en "…" en un límite de palabra.
 */
export function fitName(name: string): { fontSize: number; lines: string[] } {
  const words = name.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  for (const fontSize of NAME_SIZES) {
    const max = charsPerLine(fontSize)
    if (words.every((word) => word.length <= max)) {
      const lines = wrap(words, max)
      if (lines.length <= MAX_LINES) return { fontSize, lines }
    }
  }
  const fontSize = NAME_SIZES[NAME_SIZES.length - 1]
  const max = charsPerLine(fontSize)
  const lines = wrap(words, max)
  if (lines.length <= MAX_LINES) return { fontSize, lines }
  const kept = lines.slice(0, MAX_LINES)
  let last = kept[MAX_LINES - 1]
  while (last.length + 1 > max && last.includes(' ')) last = last.slice(0, last.lastIndexOf(' '))
  if (last.length + 1 > max) last = last.slice(0, max - 1)
  kept[MAX_LINES - 1] = `${last.replace(/[\s.,;:·-]+$/u, '')}…`
  return { fontSize, lines: kept }
}
