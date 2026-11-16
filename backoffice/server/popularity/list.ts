import type { NeonQueryFunction } from '@neondatabase/serverless'
import { montevideoDay } from '../../src/data/events.ts'
import type { PopularityResponse, PopularityRow } from '../../src/types/popularity.ts'
import { popularityQuery } from './queries.ts'

export type PopularityReader = {
  list(now?: Date): Promise<PopularityResponse>
}

type Run = (text: string, params: unknown[]) => Promise<Record<string, unknown>[]>

/** Sólo lectura de place_event_daily y place_events (los escribe la app). */
export function popularityReader(run: Run): PopularityReader {
  return {
    async list(now = new Date()) {
      const today = montevideoDay(now)
      const query = popularityQuery(today)
      const rows = (await run(query.text, query.params)) as PopularityRow[]
      return { today, rows }
    },
  }
}

export function neonPopularityReader(client: NeonQueryFunction<false, false>): PopularityReader {
  return popularityReader((text, params) => client.query(text, params) as Promise<Record<string, unknown>[]>)
}
