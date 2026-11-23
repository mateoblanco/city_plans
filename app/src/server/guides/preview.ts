import { timingSafeEqual } from 'node:crypto'

/**
 * La vista previa de una guía: /guides/...?preview=<GUIDES_PREVIEW_SECRET>. El proxy la reescribe a la ruta interna
 * /guide-preview/... (dinámica, sin cache y noindex), que la vuelve a chequear. Sin la variable no hay vista previa.
 */
export const PREVIEW_PARAM = 'preview'
export const PREVIEW_PREFIX = '/guide-preview'

/** Si la clave coincide con la del entorno, comparada en tiempo constante. Vacía o sin variable: nunca. */
export function isPreviewKey(value: string | null | undefined, secret: string | undefined = process.env.GUIDES_PREVIEW_SECRET): boolean {
  const expected = secret?.trim()
  if (!expected || !value) return false
  const a = Buffer.from(value)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** /guides/montevideo/<slug> → /guide-preview/montevideo/<slug>; null si no tiene la forma de una guía. */
export function previewPath(pathname: string): string | null {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean)
  if (parts[0] !== 'guides' || parts.length !== 3) return null
  return `${PREVIEW_PREFIX}/${parts.slice(1).join('/')}`
}
