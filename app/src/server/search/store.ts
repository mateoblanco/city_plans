import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'
import {
  candidatesQuery,
  countQuery,
  likeSimilaritiesQuery,
  nameMatchQuery,
  neighborhoodsQuery,
  type CandidateFilters,
  type CandidateRow,
  type LikeSimilarities,
  type NameMatch,
  type ScoreInputs,
} from './candidates'

export type PlacesStore = {
  candidates(filters: CandidateFilters, scores: ScoreInputs): Promise<CandidateRow[]>
  nameMatches(name: string): Promise<NameMatch[]>
  count(filters: CandidateFilters): Promise<number>
  /** Ids de barrio con al menos un lugar publicado. */
  neighborhoods(): Promise<string[]>
  /** Likes válidos y el parecido de cada candidato con el perfil y con cada like. */
  likeSimilarities(likeIds: string[], candidateIds: string[], percentile: number): Promise<LikeSimilarities>
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
    async neighborhoods() {
      const { rows } = await db.execute(neighborhoodsQuery())
      return (rows as { id: string }[]).map((row) => row.id)
    },
    async likeSimilarities(likeIds, candidateIds, percentile) {
      const { rows } = await db.execute(likeSimilaritiesQuery(likeIds, candidateIds, percentile))
      const result = rows[0] as LikeSimilarities | undefined
      return { liked: result?.liked ?? [], rows: result?.rows ?? [] }
    },
  }
}
