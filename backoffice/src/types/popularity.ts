import type { EventOrigin } from '../data/events.ts'

/** Popularidad de un lugar, sólo días cerrados (hasta ayer en Montevideo). `saves*` es el neto (guardar − sacar). */
export type PopularityRow = {
  id: string
  name: string
  slug: string
  views7: number
  views30: number
  saves7: number
  saves30: number
  directions7: number
  directions30: number
  /** De dónde vinieron las vistas de los 30 días. */
  origins: Partial<Record<EventOrigin, number>>
  /** Las 3 filas de la home que más vistas trajeron. */
  homeRows: { row: string; count: number }[]
}

export type PopularityResponse = {
  /** Hoy en Montevideo: los totales van hasta el día anterior. */
  today: string
  rows: PopularityRow[]
}
