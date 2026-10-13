import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'
import { candidatesQuery, countQuery, nameMatchQuery, type CandidateFilters, type CandidateRow, type NameMatch, type ScoreInputs } from './candidates'

export type PlacesStore = {
  candidates(filters: CandidateFilters, scores: ScoreInputs): Promise<CandidateRow[]>
  nameMatches(name: string): Promise<NameMatch[]>
  count(filters: CandidateFilters): Promise<number>
}

export function neonPlacesStore(db: Pick<NeonHttpDatabase<Record<string, unknown>>, 'execute'>): PlacesStore {
  return {
    async candidates(filters, scores) {
      const { rows } = await db.execute(candidatesQuery(filters, scores))
      return rows as CandidateRow[]
    },
    async nameMatches(name) {
      const { rows } = await db.execute(nameMatchQuery(name))
      return rows as NameMatch[]
    },
    async count(filters) {
      const { rows } = await db.execute(countQuery(filters))
      return Number((rows[0] as { count: number } | undefined)?.count ?? 0)
    },
  }
}
