import 'server-only'
import sharp from 'sharp'
import { OG_LAYOUT } from './model'

/**
 * El logo de R2 listo para Satori: los logos son WebP y Satori sólo lee PNG, JPEG, GIF y SVG, así que se pasa a PNG (con
 * la transparencia: queda sobre el color del recuadro, como en la ficha) y del tamaño en que se dibuja. Ante cualquier
 * problema (no responde, tarda, no es una imagen, pesa demasiado, no se puede leer) devuelve null y la imagen sale sin
 * logo: nunca una imagen rota ni un error.
 */
const TIMEOUT_MS = 3000
const MAX_BYTES = 2 * 1024 * 1024

export type OgLogo = { src: string; width: number; height: number }

export async function loadLogoPng(url: string, fetcher: typeof fetch = fetch): Promise<OgLogo | null> {
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return null
    const input = Buffer.from(await response.arrayBuffer())
    if (input.byteLength === 0 || input.byteLength > MAX_BYTES) return null
    const { data, info } = await sharp(input)
      .resize({ width: OG_LAYOUT.logoMax, height: OG_LAYOUT.logoMax, fit: 'inside' })
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true })
    return { src: `data:image/png;base64,${data.toString('base64')}`, width: info.width, height: info.height }
  } catch {
    return null
  }
}
