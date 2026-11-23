import { connection } from "next/server";
import { getPublishedPlace } from "@/server/places/place";
import { placeOgParts, renderPlaceOg, SHORT_CACHE } from "@/server/og/place-image";
import { placeOgVersion } from "@/server/og/model";

type Context = { params: Promise<{ slug: string; version: string }> };

// Imagen para compartir de la ficha (server/og), con ImageResponse (en JPEG: ver renderPlaceOg). La versión (logo, color, nombre y diseño) va en la
// URL, así que cada URL es siempre la misma imagen: se genera una vez y la guardan el navegador y la CDN por un año.
// No es el file convention opengraph-image: con generateImageMetadata (lo que da el alt por lugar y la versión en la
// URL), Next le arma generateStaticParams a la ruta y, con cacheComponents, no puede leer la base por pedido. Sin Google.
export async function GET(_request: Request, context: Context) {
  const { slug, version } = await context.params;
  await connection();
  const place = await getPublishedPlace(slug);
  if (!place) return new Response(null, { status: 404 });
  const image = await renderPlaceOg(await placeOgParts(place));
  // Una versión vieja (cambió el logo, el color o el nombre): la imagen actual, sin guardarla por un año en esa URL.
  if (version !== placeOgVersion({ name: place.name, logoKey: place.logo_key, logoBgColor: place.logo_bg_color })) {
    for (const [key, value] of Object.entries(SHORT_CACHE)) image.headers.set(key, value);
  }
  return image;
}
