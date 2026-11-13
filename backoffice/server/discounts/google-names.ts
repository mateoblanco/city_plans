import type { CandidateDetail } from '../../src/types/discounts.ts'

/** Cuánto vive en memoria el nombre y la dirección de un resultado de Google. Nunca va a la base ni a disco. */
export const GOOGLE_NAMES_TTL_MS = 60 * 60 * 1000
export const GOOGLE_NAMES_MAX = 500

export type GoogleName = CandidateDetail & { primaryType: string | null }

/**
 * Nombre, dirección y tipo de los resultados de Google vistos (búsquedas y refrescos de candidatos guardados): sólo en
 * memoria y por poco tiempo, como pide el uso de Places (de Google se guarda sólo place_id y coordenadas).
 */
export class GoogleNameCache {
  private readonly items = new Map<string, GoogleName & { at: number }>()
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly max: number

  constructor(options: { now?: () => number; ttlMs?: number; max?: number } = {}) {
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs ?? GOOGLE_NAMES_TTL_MS
    this.max = options.max ?? GOOGLE_NAMES_MAX
  }

  get(placeId: string): GoogleName | null {
    const item = this.items.get(placeId)
    if (!item) return null
    if (this.now() - item.at > this.ttlMs) {
      this.items.delete(placeId)
      return null
    }
    const { at: _at, ...name } = item
    return name
  }

  set(placeId: string, name: GoogleName) {
    this.items.delete(placeId)
    this.items.set(placeId, { ...name, at: this.now() })
    // El más viejo primero (orden de inserción).
    while (this.items.size > this.max) this.items.delete(this.items.keys().next().value as string)
  }

  /** Los vigentes, para el progreso de la búsqueda. */
  entries(): [string, GoogleName][] {
    return [...this.items.keys()].flatMap((id) => {
      const name = this.get(id)
      return name ? [[id, name] as [string, GoogleName]] : []
    })
  }
}
