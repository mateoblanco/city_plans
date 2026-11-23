import 'server-only'
import { ImageResponse } from 'next/og'
import sharp from 'sharp'
import { logoUrl } from '@/server/search/logo'
import type { PlaceRow } from '@/server/places/place'
import { loadSwitzer600, type OgFont } from './font'
import { OgFrame, OgName } from './frame'
import { loadLogoPng, type OgLogo } from './logo'
import { fitName, OG_SIZE, placeOgModel, type PlaceOgModel } from './model'

/** Con la versión en la URL, lo que salió bien se guarda un año en el navegador y en la CDN de Vercel. */
export const LONG_CACHE = { 'cache-control': 'public, immutable, no-transform, max-age=31536000', 'cdn-cache-control': 'public, max-age=31536000' }
/** Si el logo o la fuente no cargaron, la imagen no queda congelada en esa versión: cinco minutos. */
export const SHORT_CACHE = { 'cache-control': 'public, no-transform, max-age=300', 'cdn-cache-control': 'public, max-age=300' }

export type PlaceOgParts = { model: PlaceOgModel; logo: OgLogo | null; font: OgFont | null; degraded: boolean }

type Deps = { loadLogo?: typeof loadLogoPng; loadFont?: typeof loadSwitzer600 }

/**
 * Lo que va en la imagen de una ficha, sólo con la fila de la base y el logo de R2 (nunca Google). Si hay logo y no carga,
 * la versión sin logo; la fuente sólo se pide para el nombre.
 */
export async function placeOgParts(place: Pick<PlaceRow, 'name' | 'logo_key' | 'logo_bg_color'>, deps: Deps = {}): Promise<PlaceOgParts> {
  const input = { name: place.name, logoKey: place.logo_key, logoUrl: logoUrl(place.logo_key), logoBgColor: place.logo_bg_color }
  const wanted = placeOgModel(input)
  const logo = wanted.logoUrl ? await (deps.loadLogo ?? loadLogoPng)(wanted.logoUrl) : null
  const model = wanted.kind === 'logo' && !logo ? placeOgModel(input, false) : wanted
  const font = model.kind === 'name' ? await (deps.loadFont ?? loadSwitzer600)() : null
  const degraded = (wanted.kind === 'logo' && !logo) || (model.kind === 'name' && !font)
  return { model, logo, font, degraded }
}

/**
 * Satori sólo saca PNG, y con un logo tipo foto el PNG llegaba a 417 KB (WhatsApp a veces no muestra las de más de
 * ~300 KB). Se pasa a JPEG calidad 90 sin submuestreo de color (los bordes del texto y del logo quedan limpios): el peor
 * caso medido con todas las fichas fue 68 KB. Si la conversión falla, sale el PNG con caché corta.
 */
export async function renderPlaceOg(parts: PlaceOgParts): Promise<Response> {
  const name = fitName(parts.model.name)
  const png = await new ImageResponse(
    (
      <OgFrame bandColor={parts.model.bandColor} boxColor={parts.model.boxColor} borderColor={parts.model.borderColor}>
        {parts.logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- es Satori, no la app
          <img src={parts.logo.src} width={parts.logo.width} height={parts.logo.height} alt="" />
        ) : (
          <OgName fontSize={name.fontSize} lines={name.lines} fontFamily={parts.font?.name} />
        )}
      </OgFrame>
    ),
    { ...OG_SIZE, fonts: parts.font ? [parts.font] : undefined },
  ).arrayBuffer()
  const headers = parts.degraded ? SHORT_CACHE : LONG_CACHE
  try {
    const jpeg = await sharp(Buffer.from(png)).jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer()
    return new Response(new Uint8Array(jpeg), { headers: { ...headers, 'content-type': 'image/jpeg' } })
  } catch {
    return new Response(png, { headers: { ...SHORT_CACHE, 'content-type': 'image/png' } })
  }
}
