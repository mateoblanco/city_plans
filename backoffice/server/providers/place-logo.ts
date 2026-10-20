import { createHash } from 'node:crypto'
import { generateText, Output } from 'ai'
import sharp, { type Metadata } from 'sharp'
import { z } from 'zod'
import { LOGO_KINDS } from '../../src/data/place-schema.ts'
import type { LogoIssue, LogoKind, PlaceLogo, PlaceReview } from '../../src/types/places.ts'
import type { InstagramProfileData } from './apify-instagram-provider.ts'
import type { LogoStore } from './logo-storage.ts'
import type { LlmUsage } from './place-extraction-service.ts'

export const DEFAULT_LOGO_MODEL = 'anthropic/claude-haiku-5.5'
export const LOGO_SIZE = 256
export const MIN_LOGO_PX = 150
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 15_000

export function logoModel(env: Record<string, string | undefined> = process.env): string {
  return env.LOGO_MODEL?.trim() || DEFAULT_LOGO_MODEL
}

// ── Avatar genérico de Instagram ──

// Nombres de archivo con que el CDN sirve el avatar por defecto, en cualquier tamaño: el actual
// (silueta gris sobre gris claro, 2026) y el anterior. Instagram los cambia: el hash es el respaldo.
const GENERIC_AVATAR_FILES = [
  '573323465_1219825463302212_7278921664109726296_n',
  '44884218_345707102882519_2446069589734326272_n',
]
// Hash perceptual del avatar por defecto a 224 y 150 px (los dos tamaños que sirve el CDN), y no
// sha256: el CDN lo recodifica en cada tamaño y los bytes cambian. Un dHash no sirve: en un fondo
// plano los vecinos son iguales y el ruido del JPEG da vuelta los bits.
export const GENERIC_AVATAR_HASHES: readonly string[] = [
  'f5f5f5f5f5f5f5f5f5f5f5dddcf5f5f5f5f5d08888cbf5f5f5f5bb8888b6f5f5f5f5e8a3a1e6f5f5f5f5d5b2b2d6f5f5f5c288888888c2f5ec8a888888888aeb',
  'f5f5f4f8faf5f5f5f5f4f8e6dbf6f6f5f4f9dd8b7fbcfaf4f3fdbf7b8195f7f5f4f7e8a091cef9f4f4f9efc7bae4f9f5fadc90828483c0f9f2978189888682da',
]
// Medido (2026-10): el avatar entre tamaños da ~6; el logo real más parecido (Oriundo, fondo
// claro liso) da ~39. 15 deja margen de los dos lados.
const GENERIC_AVATAR_MAX_DIFF = 15

export function isGenericAvatarUrl(url: string): boolean {
  return GENERIC_AVATAR_FILES.some((file) => url.includes(file))
}

/** Miniatura de 8×8 en escala de grises, en hex (64 bytes). */
export async function imageHash(image: Buffer): Promise<string> {
  const pixels = await sharp(image).flatten({ background: '#ffffff' }).grayscale().resize(8, 8, { fit: 'fill' }).raw().toBuffer()
  return pixels.toString('hex')
}

/** Diferencia media de gris (0 a 255) entre dos hashes. */
export function hashDistance(a: string, b: string): number {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  let total = 0
  for (let index = 0; index < left.length; index += 1) total += Math.abs(left[index] - right[index])
  return total / left.length
}

export function isGenericAvatarHash(hash: string, references: readonly string[] = GENERIC_AVATAR_HASHES): boolean {
  return references.some((reference) => hashDistance(hash, reference) <= GENERIC_AVATAR_MAX_DIFF)
}

// ── Colores ──

type Rgb = [number, number, number]

const toHex = ([r, g, b]: Rgb) => `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`
const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
// Saturación HSV suficiente y no casi negro: los casi blancos y grises tienen saturación baja.
const isChromatic = ([r, g, b]: Rgb) => {
  const max = Math.max(r, g, b)
  return max >= 0.15 * 255 && (max - Math.max(0, Math.min(r, g, b))) / max >= 0.25
}

const CLUSTER_RADIUS = 28
const BACKGROUND_RADIUS = 40
// Un color con saturación gana sólo si su grupo es al menos esta parte del primer plano: los
// bordes suavizados entre un fondo de color y un texto blanco son cromáticos pero dispersos
// (Freddo: 5 %), y un color real ocupa bastante más (Oriundo: 52 %).
const MIN_CHROMATIC_SHARE = 0.15

/**
 * Grupo de color más presente: el bucket más poblado (4 bits por canal) y todos los píxeles a
 * menos de CLUSTER_RADIUS de su color, para que un fondo con ruido de JPEG no se parta en dos buckets.
 * El color es el exacto más repetido del bucket: el promedio mezcla los bordes suavizados.
 */
function dominantCluster(pixels: Rgb[]): { color: Rgb; count: number } | null {
  if (pixels.length === 0) return null
  const buckets = new Map<number, { count: number; colors: Map<number, number> }>()
  for (const [r, g, b] of pixels) {
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const bucket = buckets.get(key) ?? { count: 0, colors: new Map() }
    const exact = (r << 16) | (g << 8) | b
    bucket.count += 1
    bucket.colors.set(exact, (bucket.colors.get(exact) ?? 0) + 1)
    buckets.set(key, bucket)
  }
  const top = [...buckets.values()].reduce((best, bucket) => bucket.count > best.count ? bucket : best)
  const [mode] = [...top.colors].reduce((best, entry) => entry[1] > best[1] ? entry : best)
  const color: Rgb = [(mode >> 16) & 255, (mode >> 8) & 255, mode & 255]
  return { color, count: pixels.filter((pixel) => distance(pixel, color) <= CLUSTER_RADIUS).length }
}

/**
 * bgColor: color dominante del anillo de borde, si es un fondo claro (≥ 50 % del borde y
 * no más de 30 % transparente). color: dominante del resto, prefiriendo colores con saturación.
 */
export function extractLogoColors(rgba: Uint8Array | Buffer, width: number, height: number): { bgColor: string | null; color: string | null } {
  const ring = Math.max(2, Math.round(Math.min(width, height) * 0.05))
  const border: Rgb[] = []
  const inner: Rgb[] = []
  let borderTotal = 0
  let borderTransparent = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const opaque = rgba[offset + 3] >= 128
      const pixel: Rgb = [rgba[offset], rgba[offset + 1], rgba[offset + 2]]
      const onBorder = x < ring || y < ring || x >= width - ring || y >= height - ring
      if (onBorder) {
        borderTotal += 1
        if (!opaque) borderTransparent += 1
        else border.push(pixel)
      }
      if (opaque) inner.push(pixel)
    }
  }
  const borderCluster = borderTransparent / borderTotal > 0.3 ? null : dominantCluster(border)
  const background = borderCluster && borderCluster.count / borderTotal >= 0.5 ? borderCluster.color : null
  const foreground = background ? inner.filter((pixel) => distance(pixel, background) > BACKGROUND_RADIUS) : inner
  const chromatic = dominantCluster(foreground.filter(isChromatic))
  const main = chromatic && chromatic.count >= foreground.length * MIN_CHROMATIC_SHARE ? chromatic : dominantCluster(foreground)
  return { bgColor: background ? toHex(background) : null, color: main ? toHex(main.color) : null }
}

// ── Clasificación ──

const LogoClassification = z.object({ kind: z.enum(LOGO_KINDS) })

const LOGO_PROMPT = `Clasificá la foto de perfil de Instagram de un local gastronómico de Montevideo. Devolvé kind:
- logo: logotipo, isotipo, nombre escrito o ilustración de la marca, con o sin fondo.
- local: foto del local por dentro o por fuera (fachada, salón, barra, cartel en la calle).
- food: comida o bebida.
- person: una o más personas en primer plano.
- other: cualquier otra cosa.
Si un logo ocupa la mayor parte de la imagen, aunque esté sobre una foto, es logo.`

export type LogoClassifier = (image: Buffer, model: string) => Promise<{ kind: LogoKind } & Partial<LlmUsage>>

export const classifyLogo: LogoClassifier = async (image, model) => {
  const result = await generateText({
    model,
    output: Output.object({ schema: LogoClassification }),
    system: LOGO_PROMPT,
    messages: [{ role: 'user', content: [{ type: 'image', image, mediaType: 'image/jpeg' }] }],
    ...(model.startsWith('anthropic/') ? { providerOptions: { anthropic: { structuredOutputMode: 'outputFormat' } } } : {}),
    // Los 429 los reintenta withRateLimitRetry, no el AI SDK.
    maxRetries: 0,
  })
  const gatewayCost = Number((result.providerMetadata?.gateway as { cost?: unknown } | undefined)?.cost)
  return {
    kind: result.output.kind,
    inputTokens: result.usage?.inputTokens ?? null,
    cachedInputTokens: result.usage?.inputTokenDetails?.cacheReadTokens ?? null,
    cacheWriteTokens: result.usage?.inputTokenDetails?.cacheWriteTokens ?? null,
    outputTokens: result.usage?.outputTokens ?? null,
    gatewayCostUsd: Number.isFinite(gatewayCost) ? gatewayCost : null,
  }
}

// ── Paso del pipeline ──

export type LogoDeps = {
  storage?: LogoStore
  classify: LogoClassifier
  model: string
  fetcher?: typeof fetch
  now?: () => Date
  /** Clasificación ya hecha al elegir el perfil (classifyProfilePicture): no se vuelve a pagar. */
  known?: PictureClassification | null
}

export type LogoOutcome = {
  logo: PlaceLogo | null
  review: PlaceReview['logo']
  /** Uso del modelo de clasificación, si se llegó a llamar; el costo lo calcula el servicio. */
  classification: { model: string; usage: LlmUsage } | null
}

/** Qué muestra la foto y el uso del modelo que la clasificó. */
export type PictureClassification = { kind: LogoKind; classification: NonNullable<LogoOutcome['classification']> }

/** La foto a 512 px sobre blanco, en JPEG: lo que ve el clasificador. */
function classificationPreview(original: Buffer): Promise<Buffer> {
  return sharp(original).rotate().resize(512, 512, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer()
}

/** Clasifica la vista previa; null si el modelo falla. */
async function runClassifier(preview: Buffer, classify: LogoClassifier, model: string): Promise<PictureClassification | null> {
  try {
    const { kind, ...usage } = await classify(preview, model)
    return {
      kind,
      classification: {
        model,
        usage: {
          inputTokens: usage.inputTokens ?? null,
          cachedInputTokens: usage.cachedInputTokens ?? null,
          cacheWriteTokens: usage.cacheWriteTokens ?? null,
          outputTokens: usage.outputTokens ?? null,
          gatewayCostUsd: usage.gatewayCostUsd ?? null,
        },
      },
    }
  } catch {
    return null
  }
}

// Sin foto usable es "missing"; si un paso falló con una foto válida, "failed".
const MISSING_ISSUES = new Set<LogoIssue>(['no_instagram', 'no_picture', 'not_image', 'too_small', 'generic_avatar', 'person_photo'])

function withoutLogo(
  reason: LogoIssue,
  kind: LogoKind | null = null,
  classification: LogoOutcome['classification'] = null,
  detail: string | null = null,
): LogoOutcome {
  return {
    logo: null,
    review: { status: MISSING_ISSUES.has(reason) ? 'missing' : 'failed', reason, kind, ...(detail ? { detail } : {}) },
    classification,
  }
}

type Download = { body: Buffer; contentType: string | null } | { error: string }

/** La foto, o por qué no se pudo bajar: el código HTTP, timeout, red, muy grande o vacía. */
async function download(url: string, fetcher: typeof fetch): Promise<Download> {
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
    if (!response.ok) return { error: String(response.status) }
    if (Number(response.headers.get('content-length')) > MAX_DOWNLOAD_BYTES) return { error: 'muy grande' }
    const body = Buffer.from(await response.arrayBuffer())
    if (body.length === 0) return { error: 'vacía' }
    if (body.length > MAX_DOWNLOAD_BYTES) return { error: 'muy grande' }
    return { body, contentType: response.headers.get('content-type')?.split(';')[0].trim() || null }
  } catch (error) {
    return { error: error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : 'red' }
  }
}

export type ProfilePictureStatus = 'real' | 'generic' | 'unknown'

/**
 * Si la foto de perfil es el avatar genérico de Instagram, con la misma detección que el logo: el nombre de
 * archivo del CDN y, si no alcanza, el hash perceptual. unknown: sin foto, sin poder bajarla o si no es imagen.
 */
export async function profilePictureStatus(url: string | undefined, fetcher: typeof fetch = fetch): Promise<ProfilePictureStatus> {
  if (!url) return 'unknown'
  if (isGenericAvatarUrl(url)) return 'generic'
  const downloaded = await download(url, fetcher)
  if ('error' in downloaded) return 'unknown'
  try {
    return isGenericAvatarHash(await imageHash(downloaded.body)) ? 'generic' : 'real'
  } catch {
    return 'unknown'
  }
}

/**
 * Qué muestra la foto de perfil (logo, local, comida, persona u otra), para decidir el perfil antes del paso del
 * logo. null sin foto, con el avatar genérico, si no se pudo bajar, si no es imagen o si el modelo falló.
 */
export async function classifyProfilePicture(url: string | undefined, deps: Pick<LogoDeps, 'classify' | 'model' | 'fetcher'>): Promise<PictureClassification | null> {
  if (!url || isGenericAvatarUrl(url)) return null
  const downloaded = await download(url, deps.fetcher ?? fetch)
  if ('error' in downloaded) return null
  let preview: Buffer
  try {
    if (isGenericAvatarHash(await imageHash(downloaded.body))) return null
    preview = await classificationPreview(downloaded.body)
  } catch {
    return null
  }
  return runClassifier(preview, deps.classify, deps.model)
}

/**
 * Foto de perfil del Instagram validado → validada, clasificada, con colores, 256×256 WebP en R2.
 * Nunca tira error: cualquier fallo vuelve como reason y el lugar se guarda igual sin logo.
 */
export async function fetchPlaceLogo(profile: InstagramProfileData | null, googlePlaceId: string, deps: LogoDeps): Promise<LogoOutcome> {
  if (!profile) return withoutLogo('no_instagram')
  if (!profile.profilePicUrl) return withoutLogo('no_picture')
  if (isGenericAvatarUrl(profile.profilePicUrl)) return withoutLogo('generic_avatar')
  // Sin bucket no tiene sentido bajar ni pagar la clasificación.
  if (!deps.storage?.configured) return withoutLogo('storage_not_configured')

  const downloaded = await download(profile.profilePicUrl, deps.fetcher ?? fetch)
  if ('error' in downloaded) return withoutLogo('download_failed', null, null, downloaded.error)
  const original = downloaded.body
  const notImage = () => withoutLogo('not_image', null, null, downloaded.contentType)
  let metadata: Metadata
  try {
    metadata = await sharp(original).metadata()
  } catch {
    return notImage()
  }
  if (!metadata.format || !metadata.width || !metadata.height) return notImage()
  if (Math.min(metadata.width, metadata.height) < MIN_LOGO_PX) return withoutLogo('too_small')

  let webp: Buffer
  let preview: Buffer
  let colors: ReturnType<typeof extractLogoColors>
  try {
    if (isGenericAvatarHash(await imageHash(original))) return withoutLogo('generic_avatar')
    const square = sharp(original).rotate().resize(LOGO_SIZE, LOGO_SIZE, { fit: 'cover', position: 'centre' })
    webp = await square.clone().webp({ quality: 85 }).toBuffer()
    // Colores sobre el mismo recorte que se muestra, a 128 px.
    const raw = await sharp(original).rotate().resize(128, 128, { fit: 'cover', position: 'centre' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    colors = extractLogoColors(raw.data, raw.info.width, raw.info.height)
    preview = deps.known ? original : await classificationPreview(original)
  } catch {
    return withoutLogo('processing_failed')
  }

  // La clasificación se guarda siempre que se pueda; si falla, se sigue con kind null. Si ya se clasificó al
  // elegir el perfil, se usa esa (su costo ya se contó ahí).
  const classified = deps.known ?? await runClassifier(preview, deps.classify, deps.model)
  const kind: LogoKind | null = classified?.kind ?? null
  const classification: LogoOutcome['classification'] = deps.known ? null : classified?.classification ?? null

  // Una foto de una persona no sirve de logo: no se sube y el lugar queda sin logo.
  if (kind === 'person') return withoutLogo('person_photo', kind, classification)

  const key = `logos/${googlePlaceId}-${createHash('sha256').update(webp).digest('hex').slice(0, 8)}.webp`
  try {
    await deps.storage!.put(key, webp)
  } catch {
    return withoutLogo('upload_failed', kind, classification)
  }
  return {
    logo: { key, kind, ...colors, source: 'instagram', fetchedAt: (deps.now?.() ?? new Date()).toISOString() },
    review: kind ? { status: 'ok', reason: null, kind } : { status: 'failed', reason: 'classification_failed', kind: null },
    classification,
  }
}
