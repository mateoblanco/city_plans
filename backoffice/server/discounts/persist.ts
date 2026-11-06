import type { DiscountBenefit, DiscountLink, DiscountPlace, DiscountRun, MatchCandidate, MatchStatus, ProviderPlace } from '../../src/types/discounts.ts'
import { matchPlace, type AutoMatch, type MatchablePlace } from './match.ts'
import type { ReaderResult } from './reader.ts'

/** Lo que el planificador necesita saber de un lugar ya guardado del proveedor. */
export type ExistingDiscountPlace = {
  id: string
  ignored: boolean
  matchOrigin: 'auto' | 'manual'
}

export type BenefitUpsert = DiscountBenefit & { discountPlaceId: string; active: boolean }

/** Todo lo que escribe una corrida de un proveedor. El store lo aplica en una transacción. */
export type DiscountWrites = {
  providerId: string
  runId: string
  now: string
  /** Lugares vistos: upsert (first_seen_at se conserva; active = true; los campos del cruce no se tocan acá). */
  places: ProviderPlace[]
  /** Beneficios leídos: upsert (first_seen_at se conserva). */
  benefits: BenefitUpsert[]
  /** Los lugares del proveedor que no son estos pasan a inactivos. */
  seenPlaceIds: string[]
  /** De estos lugares (los que se leyeron bien), los beneficios que no son seenBenefitIds pasan a inactivos. */
  readPlaceIds: string[]
  seenBenefitIds: string[]
  /** Cruces automáticos: sólo lugares con origen auto y no ignorados (el store vuelve a chequearlo al escribir). */
  matches: { discountPlaceId: string; status: MatchStatus; candidates: MatchCandidate[]; links: DiscountLink[] }[]
}

/** YYYY-MM-DD en Montevideo: un beneficio que vence hoy sigue vigente hoy. */
export function montevideoToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export const isExpired = (validTo: string | null, today: string) => validTo !== null && validTo < today

/**
 * Qué escribir después de leer un proveedor sin errores totales. Lo que no apareció queda inactivo (no se borra);
 * lo que vuelve, activo. Los beneficios de un detalle que no se pudo leer no se tocan. El cruce se recalcula sólo
 * para los lugares automáticos y no ignorados: lo manual y lo ignorado no se toca nunca.
 */
export function planDiscountWrites(input: {
  providerId: string
  runId: string
  now: Date
  result: Pick<ReaderResult, 'places' | 'unread'>
  existing: ExistingDiscountPlace[]
  candidates: MatchablePlace[]
}): DiscountWrites {
  const today = montevideoToday(input.now)
  const unread = new Set(input.result.unread)
  const existing = new Map(input.existing.map((place) => [place.id, place]))
  const readPlaces = input.result.places.filter((place) => !unread.has(place.id))
  const benefits = readPlaces.flatMap((place) => place.benefits.map((benefit) => ({
    ...benefit,
    discountPlaceId: place.id,
    active: !isExpired(benefit.validTo, today),
  })))
  const matches = input.result.places
    .filter((place) => {
      const saved = existing.get(place.id)
      return !saved || (saved.matchOrigin === 'auto' && !saved.ignored)
    })
    .map((place) => {
      const match: AutoMatch = matchPlace(place, input.candidates)
      return { discountPlaceId: place.id, status: match.status, candidates: match.candidates, links: match.links }
    })
  return {
    providerId: input.providerId,
    runId: input.runId,
    now: input.now.toISOString(),
    places: input.result.places,
    benefits,
    seenPlaceIds: input.result.places.map((place) => place.id),
    readPlaceIds: readPlaces.map((place) => place.id),
    seenBenefitIds: benefits.map((benefit) => benefit.id),
    matches,
  }
}

export type ManualLink = { placeId: string; wholeBrand: boolean }

/** Persistencia de descuentos (Drizzle en drizzle-store.ts; en memoria en los tests). */
export type DiscountStore = {
  /** Los lugares guardados del proveedor, con su origen de cruce y si están ignorados. */
  existing(providerId: string): Promise<ExistingDiscountPlace[]>
  /** Aplica las escrituras de una corrida de un proveedor, en una transacción. */
  apply(writes: DiscountWrites): Promise<void>
  saveRun(run: DiscountRun): Promise<void>
  latestRun(): Promise<DiscountRun | null>
  /** Todo lo guardado, con beneficios, vínculos (con el nombre de nuestro lugar) y candidatos. */
  list(): Promise<DiscountPlace[]>
  get(id: string): Promise<DiscountPlace | null>
  /** Los vínculos auto pasan a manuales y el cruce queda manual y encontrado. */
  confirm(id: string): Promise<'ok' | 'not_found' | 'no_links'>
  /** Reemplaza los vínculos por estos, manuales: found con alguno, missing sin ninguno. */
  setLinks(id: string, links: ManualLink[]): Promise<'ok' | 'not_found' | 'unknown_places'>
  setIgnored(id: string, ignored: boolean): Promise<boolean>
  /** Vuelve a automático con este cruce (vínculos auto nuevos). */
  setAutoMatch(id: string, match: AutoMatch, now: Date): Promise<boolean>
}
