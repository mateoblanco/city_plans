/**
 * Eventos de popularidad (etapa 1: sólo se guardan). Fuente única de tipos, orígenes y SQL para la app (que escribe) y el
 * backoffice (esquema, vista y tests contra Postgres). El SQL va como texto con parámetros ($1…) para que lo corra
 * tanto Neon (`neon(url).query`) como PGlite en los tests, sin depender de drizzle.
 */

/** Lo que se guarda por evento. `unsave` sólo vive en place_events: en el resumen resta de `save`. */
export const EVENT_TYPES = ['view', 'save', 'unsave', 'directions'] as const
export type EventType = (typeof EVENT_TYPES)[number]

/** Tipos del resumen diario: `save` es el neto (guardar − sacar). */
export const DAILY_EVENT_TYPES = ['view', 'save', 'directions'] as const
export type DailyEventType = (typeof DAILY_EVENT_TYPES)[number]

/**
 * De dónde llegó la persona a la ficha: búsqueda, una fila de la home (con su id), la fila Guardados, similares,
 * otra sucursal o directo (link externo, recarga, atrás). Nunca el texto de la búsqueda.
 */
export const EVENT_ORIGINS = ['search', 'home', 'saved', 'similar', 'branch', 'direct'] as const
export type EventOrigin = (typeof EVENT_ORIGINS)[number]

/** Id de fila de la home: `breakfast`, `near`, `discount:itau`… */
export const ORIGIN_ROW_PATTERN = /^[a-z0-9_:-]{1,40}$/

/** Más que esto por código por minuto no se guarda (bots o scripts). */
export const EVENTS_PER_MINUTE = 30

/** Los eventos individuales se borran a los 90 días; el resumen queda para siempre. */
export const EVENT_RETENTION_DAYS = 90

/** Días cerrados que el cron vuelve a resumir (idempotente: se pone al día si una corrida falló). */
export const SUMMARY_DAYS = 3

export type EventInput = {
  placeId: string
  type: EventType
  visitor: string
  /** YYYY-MM-DD en Montevideo. */
  day: string
  origin: EventOrigin
  originRow: string | null
}

export type Query = { text: string; params: unknown[] }

const OPPOSITE: Partial<Record<EventType, EventType>> = { save: 'unsave', unsave: 'save' }

/**
 * Un evento, en una sola consulta. Sólo si el lugar está publicado y el código no pasó el límite del minuto. La unicidad
 * (lugar, tipo, código, día) la da la restricción de la tabla (`on conflict do nothing`), no este código.
 * Guardar y sacar se cancelan entre sí en el mismo día: guardar borra el `unsave` de hoy y, si no había, inserta `save`
 * (y al revés). Guardar y sacar el mismo día queda en cero; sacar hoy algo guardado otro día resta uno.
 */
export function insertEventQuery(event: EventInput, limit: number = EVENTS_PER_MINUTE): Query {
  const opposite = OPPOSITE[event.type] ?? null
  const params = [event.placeId, event.type, event.visitor, event.day, event.origin, event.originRow, limit, opposite]
  const text = `
with allowed as (
  select p.id from places p
  where p.id = $1::uuid and p.status = 'published'
    and (select count(*) from place_events r where r.visitor = $3 and r.created_at > now() - interval '1 minute') < $7::int
), cancelled as (
  delete from place_events e using allowed
  where $8::text is not null and e.place_id = allowed.id and e.type = $8::text and e.visitor = $3 and e.day = $4::date
  returning e.id
)
insert into place_events (place_id, type, visitor, day, origin, origin_row)
select allowed.id, $2, $3, $4::date, $5, $6 from allowed
where not exists (select 1 from cancelled)
on conflict (place_id, type, visitor, day) do nothing`
  return { text, params }
}

/**
 * Clave aleatoria del día: la crea si no está y la devuelve (hex). Con dos pedidos a la vez, el que pierde no la ve en
 * esta misma consulta (devuelve vacío) y vuelve a leer con `readSaltQuery`.
 */
export function upsertSaltQuery(day: string, saltHex: string): Query {
  return {
    text: `
with ins as (
  insert into event_salts (day, salt) values ($1::date, decode($2, 'hex')) on conflict (day) do nothing returning salt
)
select encode(salt, 'hex') as salt from ins
union all
select encode(salt, 'hex') as salt from event_salts where day = $1::date
limit 1`,
    params: [day, saltHex],
  }
}

export function readSaltQuery(day: string): Query {
  return { text: `select encode(salt, 'hex') as salt from event_salts where day = $1::date`, params: [day] }
}

/** Rearma el resumen de [from, to) (días YYYY-MM-DD). `unsave` resta de `save`. */
export function summarizeQuery(from: string, to: string): Query {
  return {
    text: `
insert into place_event_daily (place_id, type, day, total)
select place_id, case when type = 'unsave' then 'save' else type end, day,
  sum(case when type = 'unsave' then -1 else 1 end)::int
from place_events
where day >= $1::date and day < $2::date
group by 1, 2, 3
on conflict (place_id, type, day) do update set total = excluded.total`,
    params: [from, to],
  }
}

/** Borra los eventos de antes de `before` (YYYY-MM-DD). */
export function deleteOldEventsQuery(before: string): Query {
  return { text: `delete from place_events where day < $1::date`, params: [before] }
}

/** Borra las claves de los días anteriores a `today`: los códigos de esos días ya no se pueden recalcular. */
export function deleteOldSaltsQuery(today: string): Query {
  return { text: `delete from event_salts where day < $1::date`, params: [today] }
}

/** YYYY-MM-DD en Montevideo. */
export function montevideoDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** Suma días a un YYYY-MM-DD (negativo resta). */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
