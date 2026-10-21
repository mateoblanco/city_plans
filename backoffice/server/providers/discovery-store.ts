import type { Discovery } from './place-extraction-service.ts'

/**
 * Descubrimientos del paso 1 por googlePlaceId, en memoria del server, hasta que el paso 2 los usa. Tienen datos de
 * Google: no se escriben a disco. Con el vencimiento cubren la revisión de un lote; si el server se reinicia, el
 * paso 2 responde DISCOVERY_EXPIRED y hay que volver a descubrir.
 */
export const DISCOVERY_TTL_MS = 6 * 60 * 60 * 1000

export class DiscoveryStore {
  private readonly entries = new Map<string, { at: number; discovery: Discovery }>()
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(ttlMs = DISCOVERY_TTL_MS, now: () => number = Date.now) {
    this.ttlMs = ttlMs
    this.now = now
  }

  set(discovery: Discovery) {
    this.prune()
    this.entries.set(discovery.placeId, { at: this.now(), discovery })
  }

  /** El descubrimiento del lugar, o null si no hay o venció. */
  get(placeId: string): Discovery | null {
    this.prune()
    return this.entries.get(placeId)?.discovery ?? null
  }

  delete(placeId: string) {
    this.entries.delete(placeId)
  }

  private prune() {
    const now = this.now()
    for (const [placeId, entry] of this.entries) if (now - entry.at > this.ttlMs) this.entries.delete(placeId)
  }
}
