import type { DiscountBenefit, DiscountLink, DiscountPlace, DiscountPlaceSearch, DiscountRun, MatchCandidate, MatchStatus, OurPlaceStatus, ProviderPlace, StoredPlaceSearch } from '../../src/types/discounts.ts'
import { matchPlace, type AutoMatch, type MatchablePlace } from './match.ts'
import type { ReaderResult } from './reader.ts'

/** Lo que el planificador necesita saber de un lugar ya guardado del proveedor. */
export type ExistingDiscountPlace = {
  id: string
  ignored: boolean
  matchOrigin: 'auto' | 'manual'
}

export type BenefitUpsert = DiscountBenefit & { discountPlaceId: string; active: boolean }

/** Un cruce manual (vinculado o confirmado a mano) o un lugar ignorado, para copiarlo a otro proveedor. */
export type ManualMatch = {
  id: string
  status: MatchStatus
  ignored: boolean
  links: { placeId: string; wholeBrand: boolean; locationIndex: number | null }[]
}

/**
 * Los lugares de una página (`label`, en sourceTags) heredan el cruce manual del mismo logo en otro proveedor
 * (`itau:montevideo:x` ← `itau-personal-bank:montevideo:x`): DiscountProviderPage.manualMatchFrom.
 */
export type InheritedMatches = { fromProviderId: string; label: string; sources: ManualMatch[] }

/** Un cruce manual copiado: el store lo escribe como manual sólo si el lugar sigue automático y no ignorado. */
export type MatchCopy = { discountPlaceId: string; fromId: string; status: MatchStatus; ignored: boolean; links: ManualMatch['links'] }

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
  /** Cruces manuales heredados de otro proveedor (mismas reglas que matches: sólo sobre lugares auto y no ignorados). */
  copies: MatchCopy[]
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
  inherited?: InheritedMatches[]
}): DiscountWrites {
  const unread = new Set(input.result.unread)
  const existing = new Map(input.existing.map((place) => [place.id, place]))
  const readPlaces = input.result.places.filter((place) => !unread.has(place.id))
  const benefits = readPlaces.flatMap((place) => place.benefits.map((benefit) => ({
    ...benefit,
    discountPlaceId: place.id,
    // Publicado en la fuente = activo, aunque la fecha haya pasado (muchas fuentes renuevan sin actualizar el texto):
    // al leer, `expired` lo marca como "vigencia desactualizada en la fuente".
    active: true,
  })))
  // Sólo lo nuevo o automático y no ignorado se cruza (o hereda): lo manual y lo ignorado no se toca nunca.
  const isAuto = (id: string) => {
    const saved = existing.get(id)
    return !saved || (saved.matchOrigin === 'auto' && !saved.ignored)
  }
  const copies: MatchCopy[] = []
  for (const inherit of input.inherited ?? []) {
    const sources = new Map(inherit.sources.map((source) => [source.id, source]))
    for (const place of input.result.places) {
      if (!place.sourceTags.includes(inherit.label) || !isAuto(place.id) || copies.some((copy) => copy.discountPlaceId === place.id)) continue
      const fromId = `${inherit.fromProviderId}:${place.id.slice(input.providerId.length + 1)}`
      const source = sources.get(fromId)
      if (source) copies.push({ discountPlaceId: place.id, fromId, status: source.status, ignored: source.ignored, links: source.links })
    }
  }
  const copied = new Set(copies.map((copy) => copy.discountPlaceId))
  const matches = input.result.places
    .filter((place) => isAuto(place.id) && !copied.has(place.id))
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
    copies,
  }
}

export type ManualLink = { placeId: string; wholeBrand: boolean }

/** Persistencia de descuentos (Drizzle en drizzle-store.ts; en memoria en los tests). */
export type DiscountStore = {
  /** Los lugares guardados del proveedor, con su origen de cruce y si están ignorados. */
  existing(providerId: string): Promise<ExistingDiscountPlace[]>
  /** Los lugares del proveedor con cruce manual o ignorados, con sus vínculos (para heredarlos a otro proveedor). */
  manualMatches(providerId: string): Promise<ManualMatch[]>
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
  /** Las búsquedas en Google guardadas, por lugar del proveedor, con nuestro lugar como está hoy. */
  placeSearches(): Promise<Record<string, StoredPlaceSearch[]>>
  /** Guarda la búsqueda de cada local (reemplaza la del mismo locationIndex). Ninguna corrida toca estas búsquedas. */
  setPlaceSearches(updates: { discountPlaceId: string; search: DiscountPlaceSearch }[]): Promise<void>
  /** Nuestros lugares con esos googlePlaceId (para "ya existe"). */
  ourPlaces(googlePlaceIds: string[]): Promise<OurPlace[]>
}

/** Un lugar nuestro, para "ya existe" y para mostrar cómo quedó una búsqueda. */
export type OurPlace = { id: string; googlePlaceId: string; name: string; status: OurPlaceStatus }

/** Reemplaza en `current` la búsqueda del mismo local. */
export function mergeSearches(current: DiscountPlaceSearch[], search: DiscountPlaceSearch): DiscountPlaceSearch[] {
  return [...current.filter((item) => item.locationIndex !== search.locationIndex), search]
}
