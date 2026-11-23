import 'server-only'

/**
 * Switzer 600 (la del nombre en PlaceImage) para la imagen sin logo. La licencia de Fontshare no deja subirla a este repo
 * (es público) ni convertirla, así que se pide a su CDN al generar la imagen, como hace el navegador: el CSS de la API
 * trae la URL del .ttf (Satori no lee woff2). Una descarga por instancia, y sólo para las imágenes que no están en la
 * CDN. Si falla o tarda, null: la imagen sale con la fuente de ImageResponse y caché corta (route).
 */
const CSS_URL = 'https://api.fontshare.com/v2/css?f[]=switzer@600&display=swap'
const TIMEOUT_MS = 3000

export type OgFont = { name: string; data: ArrayBuffer; weight: 600; style: 'normal' }

/** La URL del .ttf en el CSS de Fontshare (que las da sin protocolo: `//cdn.fontshare.com/...`); null si no hay. */
export function ttfUrlFromCss(css: string): string | null {
  const match = css.match(/url\(['"]?([^'")]+\.ttf)['"]?\)/)
  if (!match) return null
  return match[1].startsWith('//') ? `https:${match[1]}` : match[1]
}

async function download(fetcher: typeof fetch): Promise<OgFont | null> {
  const css = await fetcher(CSS_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!css.ok) return null
  const url = ttfUrlFromCss(await css.text())
  if (!url || !/^https:\/\/cdn\.fontshare\.com\//.test(url)) return null
  const font = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!font.ok) return null
  return { name: 'Switzer', data: await font.arrayBuffer(), weight: 600, style: 'normal' }
}

let cached: Promise<OgFont | null> | null = null

export function loadSwitzer600(fetcher: typeof fetch = fetch): Promise<OgFont | null> {
  cached ??= download(fetcher).catch(() => null).then((font) => {
    // Lo fallido no queda guardado: la próxima imagen lo vuelve a intentar.
    if (!font) cached = null
    return font
  })
  return cached
}

/** Sólo para los tests. */
export function resetFontCache() {
  cached = null
}
