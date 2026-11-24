/**
 * Parámetros que nunca salen hacia Vercel Web Analytics ni Speed Insights (WebAnalytics, beforeSend):
 * - `q`: el texto que escribió la persona en el buscador.
 * - `near`: el formato viejo de "cerca mío" (`near=lat,lng`), con las coordenadas de quien compartió el link.
 * - `preview`: la clave de la vista previa de guías (GUIDES_PREVIEW_SECRET).
 * Si una página empieza a leer otro parámetro con texto libre o datos de la persona, va acá (y en la Política de privacidad).
 */
export const ANALYTICS_STRIPPED_PARAMS = ["q", "near", "preview"] as const;

/** La URL sin esos parámetros (el resto igual: ruta, filtros, intención). Si no se puede leer, sin query ni hash. */
export function analyticsUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const param of ANALYTICS_STRIPPED_PARAMS) parsed.searchParams.delete(param);
    return parsed.toString();
  } catch {
    return url.split(/[?#]/)[0];
  }
}
