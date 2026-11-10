import type { DiscountLink, DiscountPlace, DiscountPlaceSearch, DiscountRun, StoredBenefit } from '../../src/types/discounts.ts'
import { withReadDerived, type MatchablePlace } from './match.ts'
import { isExpired, mergeSearches, montevideoToday, type DiscountStore, type DiscountWrites, type OurPlace } from './persist.ts'

type Row = Omit<DiscountPlace, 'benefits' | 'match'> & {
  matchStatus: DiscountPlace['match']['status']
  matchOrigin: DiscountPlace['match']['origin']
  candidates: DiscountPlace['match']['candidates']
}

/**
 * DiscountStore en memoria, con las mismas reglas que el de Drizzle (drizzle-store.ts): para los tests de las corridas
 * y de los endpoints. `places` son nuestros lugares (para validar vínculos y poner el nombre); `ours`, los mismos con
 * googlePlaceId y status (para "ya existe" de la búsqueda en Google).
 */
export function memoryDiscountStore(places: MatchablePlace[] = [], options: { today?: () => string; seed?: DiscountPlace[]; ours?: OurPlace[] } = {}) {
  const rows = new Map<string, Row>()
  const benefits = new Map<string, StoredBenefit & { discountPlaceId: string }>()
  let links: (Omit<DiscountLink, 'name' | 'neighborhoodId'> & { discountPlaceId: string })[] = []
  const runs: DiscountRun[] = []
  // Aparte de rows, como la columna en la base: una corrida no la toca.
  const searches = new Map<string, DiscountPlaceSearch[]>()
  const ours: OurPlace[] = [...(options.ours ?? [])]
  const today = options.today ?? (() => montevideoToday(new Date()))
  const placeOf = (id: string) => places.find((place) => place.id === id)
  // Arranca con lo guardado (--dry-run sobre la base actual): lugares, beneficios y vínculos tal cual.
  for (const { benefits: seedBenefits, match, ...place } of options.seed ?? []) {
    rows.set(place.id, { ...place, matchStatus: match.status, matchOrigin: match.origin, candidates: match.candidates })
    for (const { expired: _expired, ...benefit } of seedBenefits) benefits.set(benefit.id, { ...benefit, expired: false, discountPlaceId: place.id })
    for (const { name: _name, neighborhoodId: _neighborhood, ...link } of match.links) links.push({ ...link, discountPlaceId: place.id })
  }

  function view(row: Row): DiscountPlace {
    const { matchStatus, matchOrigin, candidates, ...rest } = row
    return withReadDerived({
      ...rest,
      benefits: [...benefits.values()].filter((benefit) => benefit.discountPlaceId === row.id)
        .map(({ discountPlaceId: _id, ...benefit }) => ({ ...benefit, expired: isExpired(benefit.validTo, today()) })),
      match: {
        status: matchStatus,
        origin: matchOrigin,
        candidates,
        links: links.filter((item) => item.discountPlaceId === row.id).map(({ discountPlaceId: _id, ...item }) => ({
          ...item,
          name: placeOf(item.placeId)?.name ?? '',
          neighborhoodId: placeOf(item.placeId)?.neighborhoodId ?? '',
        })),
      },
    }, places)
  }

  const store: DiscountStore & { places: typeof places; runs: DiscountRun[]; ours: OurPlace[] } = {
    places,
    runs,
    ours,
    async existing(providerId) {
      return [...rows.values()].filter((row) => row.providerId === providerId).map((row) => ({ id: row.id, ignored: row.ignored, matchOrigin: row.matchOrigin }))
    },
    async manualMatches(providerId) {
      return [...rows.values()]
        .filter((row) => row.providerId === providerId && (row.matchOrigin === 'manual' || row.ignored))
        .map((row) => ({
          id: row.id,
          status: row.matchStatus,
          ignored: row.ignored,
          links: links.filter((item) => item.discountPlaceId === row.id).map((item) => ({ placeId: item.placeId, wholeBrand: item.wholeBrand, locationIndex: item.locationIndex })),
        }))
    },
    async apply(writes: DiscountWrites) {
      for (const { benefits: _benefits, ...place } of writes.places) {
        const saved = rows.get(place.id)
        rows.set(place.id, saved
          ? { ...saved, ...place, lastSeenAt: writes.now, active: true }
          : { ...place, firstSeenAt: writes.now, lastSeenAt: writes.now, active: true, ignored: false, matchedAt: null, matchStatus: 'missing', matchOrigin: 'auto', candidates: [] })
      }
      for (const row of rows.values()) {
        if (row.providerId === writes.providerId && !writes.seenPlaceIds.includes(row.id)) row.active = false
      }
      for (const { discountPlaceId, active, ...benefit } of writes.benefits) {
        const saved = benefits.get(benefit.id)
        benefits.set(benefit.id, { ...benefit, discountPlaceId, active, expired: false, firstSeenAt: saved?.firstSeenAt ?? writes.now, lastSeenAt: writes.now })
      }
      for (const benefit of benefits.values()) {
        if (writes.readPlaceIds.includes(benefit.discountPlaceId) && !writes.seenBenefitIds.includes(benefit.id)) benefit.active = false
      }
      for (const match of writes.matches) {
        const row = rows.get(match.discountPlaceId)
        if (!row || row.matchOrigin !== 'auto' || row.ignored) continue
        Object.assign(row, { matchStatus: match.status, candidates: match.candidates, matchedAt: writes.now })
        links = links.filter((item) => !(item.discountPlaceId === row.id && item.origin === 'auto'))
        for (const item of match.links) {
          if (!placeOf(item.placeId) || links.some((other) => other.discountPlaceId === row.id && other.placeId === item.placeId)) continue
          const { name: _name, neighborhoodId: _neighborhood, ...rest } = item
          links.push({ ...rest, discountPlaceId: row.id })
        }
      }
      for (const copy of writes.copies ?? []) {
        const row = rows.get(copy.discountPlaceId)
        if (!row || row.matchOrigin !== 'auto' || row.ignored) continue
        Object.assign(row, { matchStatus: copy.status, matchOrigin: 'manual', ignored: copy.ignored, candidates: [], matchedAt: writes.now })
        links = links.filter((item) => item.discountPlaceId !== row.id)
        for (const item of copy.links) {
          if (!placeOf(item.placeId)) continue
          links.push({ ...item, discountPlaceId: row.id, origin: 'manual', score: null, reasons: [`copiado de ${copy.fromId}`] })
        }
      }
    },
    async saveRun(run) {
      runs.push(run)
    },
    async latestRun() {
      return [...runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).at(-1) ?? null
    },
    async list() {
      return [...rows.values()].map(view)
    },
    async get(id) {
      const row = rows.get(id)
      return row ? view(row) : null
    },
    async confirm(id) {
      const row = rows.get(id)
      if (!row) return 'not_found'
      const own = links.filter((item) => item.discountPlaceId === id)
      if (own.length === 0) return 'no_links'
      for (const item of own) item.origin = 'manual'
      Object.assign(row, { matchOrigin: 'manual', matchStatus: 'found' })
      return 'ok'
    },
    async setLinks(id, next) {
      const row = rows.get(id)
      if (!row) return 'not_found'
      if (next.some((item) => !placeOf(item.placeId))) return 'unknown_places'
      links = links.filter((item) => item.discountPlaceId !== id)
      for (const item of next) links.push({ discountPlaceId: id, placeId: item.placeId, origin: 'manual', wholeBrand: item.wholeBrand, score: null, reasons: ['vinculado a mano'], locationIndex: null })
      Object.assign(row, { matchOrigin: 'manual', matchStatus: next.length ? 'found' : 'missing', matchedAt: new Date().toISOString() })
      return 'ok'
    },
    async setIgnored(id, ignored) {
      const row = rows.get(id)
      if (!row) return false
      row.ignored = ignored
      return true
    },
    async setAutoMatch(id, match, now) {
      const row = rows.get(id)
      if (!row) return false
      Object.assign(row, { matchOrigin: 'auto', matchStatus: match.status, candidates: match.candidates, matchedAt: now.toISOString() })
      links = links.filter((item) => item.discountPlaceId !== id)
      for (const { name: _name, neighborhoodId: _neighborhood, ...item } of match.links) links.push({ ...item, discountPlaceId: id })
      return true
    },
    async placeSearches() {
      return Object.fromEntries([...searches].filter(([, items]) => items.length).map(([id, items]) => [id, items.map((search) => {
        const place = search.placeId ? ours.find((item) => item.id === search.placeId) : undefined
        return { ...search, ourPlace: place ? { id: place.id, name: place.name, status: place.status } : null }
      })]))
    },
    async setPlaceSearches(updates) {
      for (const { discountPlaceId, search } of updates) {
        if (rows.has(discountPlaceId)) searches.set(discountPlaceId, mergeSearches(searches.get(discountPlaceId) ?? [], search))
      }
    },
    async ourPlaces(googlePlaceIds) {
      return ours.filter((place) => googlePlaceIds.includes(place.googlePlaceId))
    },
  }
  return store
}
