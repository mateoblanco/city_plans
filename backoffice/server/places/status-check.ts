import pMap from 'p-map'
import { closedReasonOf, type ClosedReason, type ReviewReason } from '../../src/data/review-reasons.ts'
import type { ManualOverrides } from '../../src/data/manual-overrides.ts'

const CHECK_CONCURRENCY = 4

// Place Details Pro (businessStatus es un campo Pro), precio de lista; los primeros 5.000 del mes son gratis.
export const PLACE_DETAILS_PRO_USD = 0.017

/** Lo que places:check-status lee de cada lugar publicado. */
export type StatusRow = {
  id: string
  googlePlaceId: string
  name: string
  neighborhoodId: string
  reviewReasons: ReviewReason[]
  manualOverrides: ManualOverrides
}

export type StatusVerdict =
  | { kind: 'closed'; row: StatusRow; reason: ClosedReason; manual: boolean }
  | { kind: 'not_found'; row: StatusRow }
  | { kind: 'error'; row: StatusRow; error: string }

/** Status o motivos puestos a mano (Publicar guarda los dos): no se mueve sin --override. */
export function hasManualStatus(overrides: ManualOverrides) {
  return Object.hasOwn(overrides, 'status') || Object.hasOwn(overrides, 'review_reasons')
}

/**
 * Pide el businessStatus de cada lugar (una llamada por lugar, con errores parciales: uno que falla no corta la
 * corrida). Devuelve sólo los cerrados, los que Google ya no tiene y los errores; los abiertos no se listan.
 */
export async function checkStatuses(rows: readonly StatusRow[], getBusinessStatus: (placeId: string) => Promise<string | null>): Promise<StatusVerdict[]> {
  const verdicts = await pMap(rows, async (row): Promise<StatusVerdict | null> => {
    try {
      const status = await getBusinessStatus(row.googlePlaceId)
      if (status === 'NOT_FOUND') return { kind: 'not_found', row }
      const reason = closedReasonOf(status)
      return reason ? { kind: 'closed', row, reason, manual: hasManualStatus(row.manualOverrides) } : null
    } catch (error) {
      return { kind: 'error', row, error: error instanceof Error ? error.message : String(error) }
    }
  }, { concurrency: CHECK_CONCURRENCY })
  return verdicts.filter((verdict) => verdict !== null)
}

export type StatusWrite = { id: string; reviewReasons: ReviewReason[]; clearManualStatus: boolean }

/**
 * Lo que --write escribe: status review con el motivo sumado a los que tenía. Un status a mano sólo se mueve si su id
 * está en `override`, y entonces deja de estar fijado (el pipeline vuelve a decidir). Los no encontrados nunca.
 */
export function statusWrites(verdicts: readonly StatusVerdict[], override: ReadonlySet<string>): StatusWrite[] {
  return verdicts.flatMap((verdict) => {
    if (verdict.kind !== 'closed' || (verdict.manual && !override.has(verdict.row.id))) return []
    const reviewReasons = [...new Set([...verdict.row.reviewReasons, verdict.reason])]
    return [{ id: verdict.row.id, reviewReasons, clearManualStatus: verdict.manual }]
  })
}
