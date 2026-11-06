import { sql, type SQL } from 'drizzle-orm'
import type { DiscountChoice } from './selection'

/**
 * Lo que cuenta en la app: beneficio activo de un lugar del proveedor activo y no ignorado, vinculado al lugar. La
 * fecha de fin no se mira: un beneficio que la fuente sigue publicando con la vigencia vencida ("vigencia desactualizada
 * en la fuente") cuenta como activo. `place` es la expresión del id del lugar nuestro (publicado: lo filtra quien llama).
 */
const countedFrom = (place: SQL) => sql`
  from discount_place_links dl
  join discount_places dp on dp.id = dl.discount_place_id
  join discount_benefits db on db.discount_place_id = dp.id
  where dl.place_id = ${place} and db.active and dp.active and not dp.ignored`

/** Los pares proveedor y tipo de tarjeta del lugar (para la card y el filtro), como jsonb. */
export const placeDiscountsColumn = (place: SQL) => sql`coalesce((
  select jsonb_agg(distinct jsonb_build_object('provider', dp.provider_id, 'cardType', db.card_type))
  ${countedFrom(place)}), '[]'::jsonb)`

/** El lugar tiene un beneficio que cumple alguna elección (un "other" cumple débito y crédito). */
export function discountFilterSql(place: SQL, choices: DiscountChoice[]): SQL {
  const options = choices.map((choice) => sql`(dp.provider_id = ${choice.provider} and db.card_type in (${choice.card}, 'other'))`)
  return sql`exists (select 1 ${countedFrom(place)} and (${sql.join(options, sql` or `)}))`
}

/** Cada proveedor y tipo de tarjeta con al menos un beneficio que cuenta en un lugar publicado. */
export function discountProvidersQuery(): SQL {
  return sql`
    select distinct dp.provider_id as id, db.card_type as "cardType"
    from discount_place_links dl
    join places p on p.id = dl.place_id and p.status = 'published'
    join discount_places dp on dp.id = dl.discount_place_id
    join discount_benefits db on db.discount_place_id = dp.id
    where db.active and dp.active and not dp.ignored`
}

/** Una fila de beneficio para la ficha. */
export type BenefitRow = {
  id: string
  providerId: string
  percent: number
  cardType: string
  cardTiers: string[]
  cardProgram: string | null
  daysKind: string
  days: string[]
  daysText: string | null
  mode: string
  instantPercent: number | null
  refundPercent: number | null
  capText: string | null
  capAmount: number | null
  capCurrency: string | null
  capPeriod: string | null
  conditions: string | null
  sourceUrl: string | null
}

/** Los beneficios que cuentan de un lugar, con la página de origen (la del beneficio o, sin ella, la del lugar). */
export function placeBenefitsQuery(placeId: string): SQL {
  return sql`
    select distinct on (db.id) db.id, dp.provider_id as "providerId", db.percent, db.card_type as "cardType",
      db.card_tiers as "cardTiers", db.card_program as "cardProgram", db.days_kind as "daysKind", db.days,
      db.days_text as "daysText", db.mode, db.instant_percent as "instantPercent", db.refund_percent as "refundPercent",
      db.cap_text as "capText", db.cap_amount::float as "capAmount", db.cap_currency as "capCurrency",
      db.cap_period as "capPeriod", db.conditions, coalesce(db.source_url, dp.source_url) as "sourceUrl"
    ${countedFrom(sql`${placeId}::uuid`)}
    order by db.id`
}
