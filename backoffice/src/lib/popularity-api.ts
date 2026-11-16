import { parseApiResponse } from '@/lib/places-api'
import type { PopularityResponse } from '@/types/popularity'

export async function getPopularity(signal?: AbortSignal): Promise<PopularityResponse> {
  return parseApiResponse<PopularityResponse>(await fetch('/api/popularity', { signal }))
}
