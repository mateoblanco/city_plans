// Usuario de Instagram: letras, números, punto y guion bajo, hasta 30.
const HANDLE = /^[a-z0-9._]{1,30}$/
const RESERVED_PATHS = new Set(['p', 'reel', 'reels', 'stories', 'explore'])

/**
 * Handle normalizado (minúsculas, sin @) desde lo que se pega en la revisión: `@handle`, `handle` o la URL del perfil
 * (instagram.com/handle, con o sin https ni www). null si no es un perfil de Instagram válido.
 */
export function parseInstagramHandle(value: string): string | null {
  const text = value.trim()
  if (!text) return null
  let candidate = text.replace(/^@/, '')
  if (/instagram\.com|instagr\.am/i.test(text)) {
    try {
      const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
      const host = url.hostname.toLowerCase().replace(/^www\./, '')
      if (host !== 'instagram.com' && host !== 'instagr.am') return null
      candidate = url.pathname.split('/').filter(Boolean)[0] ?? ''
    } catch {
      return null
    }
  }
  const handle = candidate.toLowerCase()
  return HANDLE.test(handle) && !RESERVED_PATHS.has(handle) ? handle : null
}
