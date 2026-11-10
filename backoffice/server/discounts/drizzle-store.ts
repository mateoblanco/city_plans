import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm'
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'
import type { BenefitDays, DiscountPlace, DiscountRun, StoredBenefit, StoredPlaceSearch, Weekday } from '../../src/types/discounts.ts'
import type * as schema from '../db/schema.ts'
import { discountBenefits, discountPlaceLinks, discountPlaces, discountRuns, places } from '../db/schema.ts'
import { withReadDerived } from './match.ts'
import { isExpired, mergeSearches, montevideoToday, type DiscountStore, type DiscountWrites } from './persist.ts'

type Db = NeonHttpDatabase<typeof schema>

const excluded = (column: string) => sql.raw(`excluded.${column}`)

function daysColumns(days: BenefitDays): { daysKind: 'all' | 'list' | 'unknown'; days: Weekday[] } {
  if (days === 'all') return { daysKind: 'all', days: [] }
  if (days === null) return { daysKind: 'unknown', days: [] }
  return { daysKind: 'list', days }
}

function daysOf(kind: string, days: string[]): BenefitDays {
  if (kind === 'all') return 'all'
  if (kind === 'unknown') return null
  return days as Weekday[]
}

/** Sólo los lugares todavía automáticos y no ignorados: una corrección hecha durante la corrida no se pisa. */
const stillAuto = (id: ReturnType<typeof sql>) => sql`exists (select 1 from ${discountPlaces} where ${discountPlaces.id} = ${id} and ${discountPlaces.matchOrigin} = 'auto' and not ${discountPlaces.ignored})`

/** Persistencia de descuentos en Neon. Cada corrida de un proveedor es un db.batch (una transacción). */
export function drizzleDiscountStore(db: Db): DiscountStore {
  async function list(where?: ReturnType<typeof eq>): Promise<DiscountPlace[]> {
    const rows = await (where ? db.select().from(discountPlaces).where(where) : db.select().from(discountPlaces))
    if (rows.length === 0) return []
    const ids = rows.map((row) => row.id)
    const [benefitRows, linkRows, ours] = await Promise.all([
      db.select().from(discountBenefits).where(inArray(discountBenefits.discountPlaceId, ids)),
      db.select({ link: discountPlaceLinks, name: places.name, neighborhoodId: places.neighborhoodId })
        .from(discountPlaceLinks)
        .innerJoin(places, eq(places.id, discountPlaceLinks.placeId))
        .where(inArray(discountPlaceLinks.discountPlaceId, ids)),
      // Para la nota de vecinos (lugares nuestros cerca de un local que no quedaron vinculados).
      db.select({ id: places.id, name: places.name, neighborhoodId: places.neighborhoodId, location: places.location }).from(places),
    ])
    const today = montevideoToday(new Date())
    return rows.map((row) => withReadDerived({
      id: row.id,
      providerId: row.providerId,
      sourceName: row.sourceName,
      category: row.category,
      city: row.city,
      departments: row.departments,
      montevideo: row.montevideo,
      locations: row.locations,
      website: row.website,
      instagram: row.instagram,
      sourceUrl: row.sourceUrl,
      logoUrl: row.logoUrl,
      description: row.description,
      sourceTags: row.sourceTags,
      campaign: { validFrom: row.campaignValidFrom, validTo: row.campaignValidTo, text: row.campaignText },
      firstSeenAt: row.firstSeenAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      active: row.active,
      ignored: row.ignored,
      matchedAt: row.matchedAt?.toISOString() ?? null,
      benefits: benefitRows.filter((benefit) => benefit.discountPlaceId === row.id).map((benefit): StoredBenefit => ({
        id: benefit.id,
        percent: benefit.percent,
        cardType: benefit.cardType,
        cardTiers: benefit.cardTiers,
        cardProgram: benefit.cardProgram,
        days: daysOf(benefit.daysKind, benefit.days),
        daysText: benefit.daysText,
        mode: benefit.mode,
        instantPercent: benefit.instantPercent,
        refundPercent: benefit.refundPercent,
        cap: benefit.capText ? { text: benefit.capText, amount: benefit.capAmount, currency: benefit.capCurrency, period: benefit.capPeriod } : null,
        validFrom: benefit.validFrom,
        validTo: benefit.validTo,
        conditions: benefit.conditions,
        sourceText: benefit.sourceText,
        sourceUrl: benefit.sourceUrl,
        parsedBy: benefit.parsedBy,
        firstSeenAt: benefit.firstSeenAt.toISOString(),
        lastSeenAt: benefit.lastSeenAt.toISOString(),
        active: benefit.active,
        expired: isExpired(benefit.validTo, today),
      })),
      match: {
        status: row.matchStatus,
        origin: row.matchOrigin,
        candidates: row.matchCandidates,
        links: linkRows.filter(({ link }) => link.discountPlaceId === row.id).map(({ link, name, neighborhoodId }) => ({
          placeId: link.placeId,
          name,
          neighborhoodId,
          origin: link.origin,
          wholeBrand: link.wholeBrand,
          score: link.score,
          reasons: link.reasons,
          locationIndex: link.locationIndex,
        })),
      },
    }, ours))
  }

  return {
    async existing(providerId) {
      return db.select({ id: discountPlaces.id, ignored: discountPlaces.ignored, matchOrigin: discountPlaces.matchOrigin })
        .from(discountPlaces).where(eq(discountPlaces.providerId, providerId))
    },

    async manualMatches(providerId) {
      const rows = await db.select({ id: discountPlaces.id, status: discountPlaces.matchStatus, ignored: discountPlaces.ignored }).from(discountPlaces)
        .where(and(eq(discountPlaces.providerId, providerId), sql`(${discountPlaces.matchOrigin} = 'manual' or ${discountPlaces.ignored})`))
      if (!rows.length) return []
      const linkRows = await db.select({ dp: discountPlaceLinks.discountPlaceId, placeId: discountPlaceLinks.placeId, wholeBrand: discountPlaceLinks.wholeBrand, locationIndex: discountPlaceLinks.locationIndex })
        .from(discountPlaceLinks).where(inArray(discountPlaceLinks.discountPlaceId, rows.map((row) => row.id)))
      return rows.map((row) => ({
        ...row,
        links: linkRows.filter((link) => link.dp === row.id).map(({ dp: _dp, ...link }) => link),
      }))
    },

    async apply(writes: DiscountWrites) {
      const now = new Date(writes.now)
      const placeValues = writes.places.map((place) => ({
        id: place.id,
        providerId: place.providerId,
        sourceName: place.sourceName,
        category: place.category,
        city: place.city,
        departments: place.departments,
        montevideo: place.montevideo,
        locations: place.locations,
        website: place.website,
        instagram: place.instagram,
        sourceUrl: place.sourceUrl,
        logoUrl: place.logoUrl,
        description: place.description,
        sourceTags: place.sourceTags,
        campaignValidFrom: place.campaign.validFrom,
        campaignValidTo: place.campaign.validTo,
        campaignText: place.campaign.text,
        firstSeenAt: now,
        lastSeenAt: now,
        active: true,
        lastRunId: writes.runId,
        updatedAt: now,
      }))
      const benefitValues = writes.benefits.map((benefit) => ({
        id: benefit.id,
        discountPlaceId: benefit.discountPlaceId,
        percent: benefit.percent,
        cardType: benefit.cardType,
        cardTiers: benefit.cardTiers,
        cardProgram: benefit.cardProgram,
        ...daysColumns(benefit.days),
        daysText: benefit.daysText,
        mode: benefit.mode,
        instantPercent: benefit.instantPercent,
        refundPercent: benefit.refundPercent,
        capText: benefit.cap?.text ?? null,
        capAmount: benefit.cap?.amount ?? null,
        capCurrency: benefit.cap?.currency ?? null,
        capPeriod: benefit.cap?.period ?? null,
        validFrom: benefit.validFrom,
        validTo: benefit.validTo,
        conditions: benefit.conditions,
        sourceText: benefit.sourceText,
        sourceUrl: benefit.sourceUrl,
        parsedBy: benefit.parsedBy,
        firstSeenAt: now,
        lastSeenAt: now,
        active: benefit.active,
      }))
      const matchRows = writes.matches.map((match) => ({ id: match.discountPlaceId, status: match.status, candidates: match.candidates }))
      const linkRows = writes.matches.flatMap((match) => match.links.map((link) => ({
        dp: match.discountPlaceId, pid: link.placeId, wb: link.wholeBrand, sc: link.score, rs: link.reasons, li: link.locationIndex,
      })))
      const matchedIds = writes.matches.map((match) => match.discountPlaceId)

      const statements = [
        // first_seen_at, ignored y el cruce no se tocan en el upsert.
        db.insert(discountPlaces).values(placeValues).onConflictDoUpdate({
          target: discountPlaces.id,
          set: Object.fromEntries([
            'provider_id', 'source_name', 'category', 'city', 'departments', 'montevideo', 'locations', 'website', 'instagram',
            'source_url', 'logo_url', 'description', 'source_tags', 'campaign_valid_from', 'campaign_valid_to', 'campaign_text',
            'last_seen_at', 'active', 'last_run_id', 'updated_at',
          ].map((column) => [column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), excluded(column)])),
        }),
        // Los que no aparecieron, inactivos (nunca se borran).
        db.update(discountPlaces).set({ active: false, updatedAt: now })
          .where(and(eq(discountPlaces.providerId, writes.providerId), notInArray(discountPlaces.id, writes.seenPlaceIds), eq(discountPlaces.active, true))),
        ...(benefitValues.length ? [db.insert(discountBenefits).values(benefitValues).onConflictDoUpdate({
          target: discountBenefits.id,
          set: Object.fromEntries([
            'discount_place_id', 'percent', 'card_type', 'card_tiers', 'card_program', 'days_kind', 'days', 'days_text', 'mode',
            'instant_percent', 'refund_percent', 'cap_text', 'cap_amount', 'cap_currency', 'cap_period', 'valid_from', 'valid_to',
            'conditions', 'source_text', 'source_url', 'parsed_by', 'last_seen_at', 'active',
          ].map((column) => [column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), excluded(column)])),
        })] : []),
        // De los detalles que se leyeron bien, los beneficios que no aparecieron, inactivos.
        ...(writes.readPlaceIds.length ? [db.update(discountBenefits).set({ active: false })
          .where(and(
            inArray(discountBenefits.discountPlaceId, writes.readPlaceIds),
            writes.seenBenefitIds.length ? notInArray(discountBenefits.id, writes.seenBenefitIds) : sql`true`,
            eq(discountBenefits.active, true),
          ))] : []),
        ...(matchRows.length ? [
          db.execute(sql`
            update ${discountPlaces} set match_status = v.status, match_candidates = v.candidates, matched_at = ${writes.now}::timestamptz
            from jsonb_to_recordset(${JSON.stringify(matchRows)}::jsonb) as v(id text, status text, candidates jsonb)
            where ${discountPlaces.id} = v.id and ${discountPlaces.matchOrigin} = 'auto' and not ${discountPlaces.ignored}`),
          db.delete(discountPlaceLinks).where(and(
            inArray(discountPlaceLinks.discountPlaceId, matchedIds),
            eq(discountPlaceLinks.origin, 'auto'),
            stillAuto(sql`${discountPlaceLinks.discountPlaceId}`),
          )),
        ] : []),
        ...(linkRows.length ? [db.execute(sql`
          insert into ${discountPlaceLinks} (discount_place_id, place_id, origin, whole_brand, score, reasons, location_index)
          select l.dp, l.pid::uuid, 'auto', l.wb, l.sc, l.rs, l.li
          from jsonb_to_recordset(${JSON.stringify(linkRows)}::jsonb) as l(dp text, pid text, wb boolean, sc real, rs text[], li integer)
          where ${stillAuto(sql`l.dp`)} and exists (select 1 from ${places} where ${places.id} = l.pid::uuid)
          on conflict do nothing`)] : []),
      ]
      // Cruces manuales heredados de otro proveedor: sólo sobre lugares que siguen automáticos y no ignorados. El lugar
      // pasa a manual al final, así los vínculos se escriben con el mismo chequeo.
      const copies = writes.copies ?? []
      if (copies.length) {
        const copyIds = copies.map((copy) => copy.discountPlaceId)
        const copyLinks = copies.flatMap((copy) => copy.links.map((link) => ({ dp: copy.discountPlaceId, pid: link.placeId, wb: link.wholeBrand, li: link.locationIndex, rs: [`copiado de ${copy.fromId}`] })))
        const copyRows = copies.map((copy) => ({ id: copy.discountPlaceId, status: copy.status, ignored: copy.ignored }))
        statements.push(
          db.delete(discountPlaceLinks).where(and(inArray(discountPlaceLinks.discountPlaceId, copyIds), stillAuto(sql`${discountPlaceLinks.discountPlaceId}`))),
          ...(copyLinks.length ? [db.execute(sql`
            insert into ${discountPlaceLinks} (discount_place_id, place_id, origin, whole_brand, score, reasons, location_index)
            select l.dp, l.pid::uuid, 'manual', l.wb, null, l.rs, l.li
            from jsonb_to_recordset(${JSON.stringify(copyLinks)}::jsonb) as l(dp text, pid text, wb boolean, li integer, rs text[])
            where ${stillAuto(sql`l.dp`)} and exists (select 1 from ${places} where ${places.id} = l.pid::uuid)
            on conflict do nothing`)] : []),
          db.execute(sql`
            update ${discountPlaces} set match_status = v.status, match_origin = 'manual', ignored = v.ignored, match_candidates = '[]'::jsonb,
              matched_at = ${writes.now}::timestamptz, updated_at = ${writes.now}::timestamptz
            from jsonb_to_recordset(${JSON.stringify(copyRows)}::jsonb) as v(id text, status text, ignored boolean)
            where ${discountPlaces.id} = v.id and ${discountPlaces.matchOrigin} = 'auto' and not ${discountPlaces.ignored}`),
        )
      }
      await db.batch(statements as unknown as Parameters<typeof db.batch>[0])
    },

    async saveRun(run: DiscountRun) {
      await db.insert(discountRuns).values({
        id: run.id,
        startedAt: new Date(run.startedAt),
        finishedAt: new Date(run.finishedAt),
        reparsedFrom: run.reparsedFrom,
        providers: run.providers,
        errors: run.errors,
        warnings: run.warnings,
      }).onConflictDoNothing()
    },

    async latestRun() {
      const [row] = await db.select().from(discountRuns).orderBy(desc(discountRuns.startedAt)).limit(1)
      if (!row) return null
      return { ...row, startedAt: row.startedAt.toISOString(), finishedAt: row.finishedAt.toISOString() }
    },

    list: () => list(),

    async get(id) {
      return (await list(eq(discountPlaces.id, id)))[0] ?? null
    },

    async confirm(id) {
      const [row] = await db.select({ id: discountPlaces.id }).from(discountPlaces).where(eq(discountPlaces.id, id))
      if (!row) return 'not_found'
      const own = await db.select({ placeId: discountPlaceLinks.placeId }).from(discountPlaceLinks).where(eq(discountPlaceLinks.discountPlaceId, id))
      if (own.length === 0) return 'no_links'
      await db.batch([
        db.update(discountPlaceLinks).set({ origin: 'manual' }).where(eq(discountPlaceLinks.discountPlaceId, id)),
        db.update(discountPlaces).set({ matchOrigin: 'manual', matchStatus: 'found', matchedAt: new Date(), updatedAt: new Date() }).where(eq(discountPlaces.id, id)),
      ])
      return 'ok'
    },

    async setLinks(id, links) {
      const [row] = await db.select({ id: discountPlaces.id }).from(discountPlaces).where(eq(discountPlaces.id, id))
      if (!row) return 'not_found'
      const ids = [...new Set(links.map((link) => link.placeId))]
      if (ids.length) {
        const found = await db.select({ id: places.id }).from(places).where(inArray(places.id, ids))
        if (found.length !== ids.length) return 'unknown_places'
      }
      const now = new Date()
      await db.batch([
        db.delete(discountPlaceLinks).where(eq(discountPlaceLinks.discountPlaceId, id)),
        ...(links.length ? [db.insert(discountPlaceLinks).values(links.map((link) => ({
          discountPlaceId: id, placeId: link.placeId, origin: 'manual' as const, wholeBrand: link.wholeBrand, score: null, reasons: ['vinculado a mano'], locationIndex: null,
        }))).onConflictDoNothing()] : []),
        db.update(discountPlaces).set({ matchOrigin: 'manual', matchStatus: links.length ? 'found' : 'missing', matchedAt: now, updatedAt: now }).where(eq(discountPlaces.id, id)),
      ] as unknown as Parameters<typeof db.batch>[0])
      return 'ok'
    },

    async setIgnored(id, ignored) {
      const updated = await db.update(discountPlaces).set({ ignored, updatedAt: new Date() }).where(eq(discountPlaces.id, id)).returning({ id: discountPlaces.id })
      return updated.length > 0
    },

    async setAutoMatch(id, match, now) {
      const [row] = await db.select({ id: discountPlaces.id }).from(discountPlaces).where(eq(discountPlaces.id, id))
      if (!row) return false
      await db.batch([
        db.delete(discountPlaceLinks).where(eq(discountPlaceLinks.discountPlaceId, id)),
        ...(match.links.length ? [db.insert(discountPlaceLinks).values(match.links.map((link) => ({
          discountPlaceId: id, placeId: link.placeId, origin: 'auto' as const, wholeBrand: link.wholeBrand, score: link.score, reasons: link.reasons, locationIndex: link.locationIndex,
        }))).onConflictDoNothing()] : []),
        db.update(discountPlaces).set({ matchOrigin: 'auto', matchStatus: match.status, matchCandidates: match.candidates, matchedAt: now, updatedAt: now }).where(eq(discountPlaces.id, id)),
      ] as unknown as Parameters<typeof db.batch>[0])
      return true
    },

    async placeSearches() {
      const rows = await db.select({ id: discountPlaces.id, searches: discountPlaces.placeSearches }).from(discountPlaces)
        .where(sql`jsonb_array_length(${discountPlaces.placeSearches}) > 0`)
      const ids = [...new Set(rows.flatMap((row) => row.searches.flatMap((search) => (search.placeId ? [search.placeId] : []))))]
      const ours = ids.length ? await db.select({ id: places.id, name: places.name, status: places.status }).from(places).where(inArray(places.id, ids)) : []
      const byId = new Map(ours.map((place) => [place.id, place]))
      return Object.fromEntries(rows.map((row) => [row.id, row.searches.map((search): StoredPlaceSearch => ({ ...search, ourPlace: (search.placeId && byId.get(search.placeId)) || null }))]))
    },

    async setPlaceSearches(updates) {
      if (!updates.length) return
      const ids = [...new Set(updates.map((update) => update.discountPlaceId))]
      const rows = await db.select({ id: discountPlaces.id, searches: discountPlaces.placeSearches }).from(discountPlaces).where(inArray(discountPlaces.id, ids))
      const next = new Map(rows.map((row) => [row.id, row.searches]))
      for (const { discountPlaceId, search } of updates) {
        const current = next.get(discountPlaceId)
        if (current) next.set(discountPlaceId, mergeSearches(current, search))
      }
      if (!next.size) return
      // Sólo esta columna: no toca updated_at ni el cruce.
      await db.execute(sql`
        update ${discountPlaces} set place_searches = v.searches
        from jsonb_to_recordset(${JSON.stringify([...next].map(([id, searches]) => ({ id, searches })))}::jsonb) as v(id text, searches jsonb)
        where ${discountPlaces.id} = v.id`)
    },

    async ourPlaces(googlePlaceIds) {
      if (!googlePlaceIds.length) return []
      const rows = await db.select({ id: places.id, googlePlaceId: places.googlePlaceId, name: places.name, status: places.status }).from(places)
        .where(inArray(places.googlePlaceId, googlePlaceIds))
      return rows.flatMap((row) => (row.googlePlaceId ? [{ ...row, googlePlaceId: row.googlePlaceId }] : []))
    },
  }
}
