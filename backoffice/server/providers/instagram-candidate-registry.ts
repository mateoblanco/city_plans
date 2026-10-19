import { brandFromGoogleName } from './brand-name.ts'
import { canonical } from './source-hosts.ts'

/**
 * Candidatos de Instagram de la primera pasada por lugar, en memoria del server. Una cuenta que aparece como
 * candidata de dos o más lugares de marcas distintas es agregadora (@lanocheuy_ salió para Duna y Doña Marta): no
 * es de ninguno. Las sucursales de una misma marca sí comparten Instagram (Cordón Beer tiene cuatro locales).
 * Uno por PlaceExtractionService (el server tiene uno solo); vive mientras corre el server, con vencimiento, así
 * cubre un lote y sus reintentos.
 */
export const CANDIDATE_TTL_MS = 12 * 60 * 60 * 1000

/** Clave de marca para comparar lugares: sin sucursal, acentos, mayúsculas ni signos. */
export function brandKey(name: string): string {
  return canonical(brandFromGoogleName(name)).replace(/[^a-z0-9]/g, '')
}

/** Por handle, los otros lugares (googlePlaceId) de otra marca que lo tienen como candidato o guardado. */
export type SharedInstagram = Map<string, string[]>

export class InstagramCandidateRegistry {
  private readonly seen = new Map<string, Map<string, { at: number; brand: string }>>()
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(ttlMs = CANDIDATE_TTL_MS, now: () => number = Date.now) {
    this.ttlMs = ttlMs
    this.now = now
  }

  /**
   * Anota los handles como candidatos del lugar y devuelve, de esos, los que ya fueron candidatos de un lugar de
   * otra marca. `brand` es el nombre del lugar (de él sale la clave de marca).
   */
  claim(placeId: string, brand: string, handles: readonly string[]): SharedInstagram {
    const now = this.now()
    const key = brandKey(brand)
    const shared: SharedInstagram = new Map()
    for (const handle of new Set(handles.map((item) => item.toLowerCase()))) {
      const places = this.seen.get(handle) ?? new Map<string, { at: number; brand: string }>()
      for (const [other, entry] of places) if (now - entry.at > this.ttlMs) places.delete(other)
      const others = [...places].filter(([other, entry]) => other !== placeId && (!key || entry.brand !== key)).map(([other]) => other)
      if (others.length > 0) shared.set(handle, others)
      places.set(placeId, { at: now, brand: key })
      this.seen.set(handle, places)
    }
    return shared
  }
}

/** Lugares de la base que ya tienen guardado alguno de los handles, sin contar el que se procesa. */
export type InstagramOwners = (handles: readonly string[], exceptPlaceId: string) => Promise<{ handle: string; googlePlaceId: string; name: string }[]>
