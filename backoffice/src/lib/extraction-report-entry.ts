import type { ExtractionReportRequest, PlaceEnrichmentResponse } from '../types/places.ts'

// Rutas relativas: también lo usa el servidor (búsqueda de Descuentos, que escribe su propio reporte del lote).

/** Un lugar terminado, como entra al reporte del lote (POST /api/extraction-reports). */
export function reportPlace(result: PlaceEnrichmentResponse): ExtractionReportRequest['places'][number] {
  const { totalUsd, providers } = result.performance.costUsd
  const mainLlmUsd = providers.llm.costUsd
  const hoursRetryUsd = result.status === 'ok' ? result.review.hoursRetry.costUsd : 0
  const logoUsd = providers.logo?.costUsd ?? 0
  const base = {
    costUsd: totalUsd,
    totalMs: result.performance.totalMs,
    sourcesUsd: Math.max(0, totalUsd - mainLlmUsd - hoursRetryUsd - logoUsd),
    mainLlmUsd,
    hoursRetryUsd,
    logoUsd,
    inputTokens: providers.llm.inputTokens ?? 0,
    cachedInputTokens: providers.llm.cachedInputTokens ?? 0,
    cacheWriteTokens: providers.llm.cacheWriteTokens ?? 0,
  }
  if (result.status !== 'ok') {
    return {
      name: result.target.name, googlePlaceId: result.target.googlePlaceId, review: null,
      stats: { ...base, hoursStatus: 'none' as const, hasInstagram: false, hasWebsite: false, tagCount: 0 },
    }
  }
  const { place } = result
  return {
    // Sin nombre confirmado por las fuentes el reporte igual necesita uno; el de Google no se usa.
    name: place.name || 'Sin nombre confirmado', googlePlaceId: place.googlePlaceId, review: result.review,
    reviewReasons: place.reviewReasons ?? [],
    stats: {
      ...base,
      hoursStatus: place.hours.status,
      hasInstagram: Boolean(place.contact.instagram),
      hasWebsite: Boolean(place.contact.website),
      tagCount: place.tags.length,
    },
  }
}
