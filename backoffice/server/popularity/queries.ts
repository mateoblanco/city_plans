import { addDays, type Query } from '../../src/data/events.ts'

/**
 * Popularidad por lugar, sólo con días cerrados (hasta ayer en Montevideo): totales de 7 y 30 días por tipo desde el
 * resumen diario (guardados = neto), y de dónde vinieron las vistas de los 30 días (place_events, que guarda 90) con las
 * 3 filas de la home que más trajeron. Sólo lugares con algún total en los 30 días.
 */
export function popularityQuery(today: string): Query {
  const from30 = addDays(today, -30)
  const from7 = addDays(today, -7)
  const text = `
with totals as (
  select place_id,
    coalesce(sum(total) filter (where type = 'view' and day >= $2::date), 0)::int as views7,
    coalesce(sum(total) filter (where type = 'view'), 0)::int as views30,
    coalesce(sum(total) filter (where type = 'save' and day >= $2::date), 0)::int as saves7,
    coalesce(sum(total) filter (where type = 'save'), 0)::int as saves30,
    coalesce(sum(total) filter (where type = 'directions' and day >= $2::date), 0)::int as directions7,
    coalesce(sum(total) filter (where type = 'directions'), 0)::int as directions30
  from place_event_daily
  where day >= $1::date and day < $3::date
  group by place_id
), views as (
  select place_id, origin, origin_row from place_events
  where type = 'view' and day >= $1::date and day < $3::date
)
select p.id, p.name, p.slug, t.views7, t.views30, t.saves7, t.saves30, t.directions7, t.directions30,
  coalesce((
    select jsonb_object_agg(o.origin, o.n) from (select origin, count(*)::int as n from views v where v.place_id = p.id group by origin) o
  ), '{}'::jsonb) as origins,
  coalesce((
    select jsonb_agg(jsonb_build_object('row', r.origin_row, 'count', r.n) order by r.n desc, r.origin_row) from (
      select origin_row, count(*)::int as n from views v
      where v.place_id = p.id and v.origin = 'home' and v.origin_row is not null
      group by origin_row order by n desc, origin_row limit 3
    ) r
  ), '[]'::jsonb) as "homeRows"
from totals t
join places p on p.id = t.place_id
order by t.views30 desc, p.name`
  return { text, params: [from30, from7, today] }
}
