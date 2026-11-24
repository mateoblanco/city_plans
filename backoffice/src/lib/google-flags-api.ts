import type { GoogleFlagsResponse } from '@/types/google-flags'
import { parseApiResponse } from '@/lib/places-api'

export async function listGoogleFlags(signal?: AbortSignal): Promise<GoogleFlagsResponse> {
  return parseApiResponse<GoogleFlagsResponse>(await fetch('/api/google-flags', { signal }))
}

export async function ignoreGoogleFlag(id: string): Promise<void> {
  const response = await fetch(`/api/google-flags/${encodeURIComponent(id)}/ignored`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ignored: true }),
  })
  await parseApiResponse<{ id: string; ignored: true }>(response)
}

export async function unpublishGoogleFlag(id: string): Promise<void> {
  const response = await fetch(`/api/google-flags/${encodeURIComponent(id)}/unpublish`, { method: 'POST' })
  await parseApiResponse<{ id: string; outcome: string }>(response)
}
