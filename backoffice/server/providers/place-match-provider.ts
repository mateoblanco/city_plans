import type {
  JsonValue,
  MatchSource,
  PlaceAnchor,
  PlaceMatchCandidate,
  PlaceMatchResponse,
} from '../../src/types/places.ts'

export const MATCH_RADIUS_METERS = 150
const BEST_MATCH_THRESHOLD = 0.55

export type RawPlaceCandidate = {
  name: string
  alternativeNames?: string[]
  address: string
  latitude: number
  longitude: number
  data: JsonValue
}

export interface PlaceMatchProvider {
  readonly source: MatchSource
  readonly attribution: string
  readonly configured: boolean
  findCandidates(anchor: PlaceAnchor): Promise<RawPlaceCandidate[]>
}

export function canonicalizeName(value: string): string {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase('es')
    .replace(/[æǽ]/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ø/g, 'o')
    .replace(/ß/g, 'ss')
    .replace(/ł/g, 'l')
    .replace(/đ/g, 'd')
    .replace(/ð/g, 'd')
    .replace(/þ/g, 'th')
    .replace(/ı/g, 'i')
    .replace(/\p{Mark}+/gu, '')
    .replace(/[’‘'`´]+/gu, '')
    .replace(/&/g, ' ')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function bigramsFromCanonical(value: string): string[] {
  const compact = value.replaceAll(' ', '')
  if (compact.length < 2) return compact ? [compact] : []
  return Array.from({ length: compact.length - 1 }, (_, index) =>
    compact.slice(index, index + 2),
  )
}

function diceSimilarity(left: string, right: string): number {
  const leftPairs = bigramsFromCanonical(left)
  const rightPairs = bigramsFromCanonical(right)
  if (leftPairs.length === 0 || rightPairs.length === 0) return 0

  const counts = new Map<string, number>()
  for (const pair of leftPairs) counts.set(pair, (counts.get(pair) ?? 0) + 1)

  let intersection = 0
  for (const pair of rightPairs) {
    const count = counts.get(pair) ?? 0
    if (count === 0) continue
    intersection += 1
    counts.set(pair, count - 1)
  }

  return (2 * intersection) / (leftPairs.length + rightPairs.length)
}

function addressSimilarity(left: string, right: string): number {
  const leftTokens = new Set(canonicalizeName(left).split(' ').filter(Boolean))
  const rightTokens = new Set(canonicalizeName(right).split(' ').filter(Boolean))
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length
  const union = new Set([...leftTokens, ...rightTokens]).size
  return intersection / union
}

function bestNameMatch(anchorName: string, candidate: RawPlaceCandidate) {
  const normalizedAnchorName = canonicalizeName(anchorName)
  const names = [candidate.name, ...(candidate.alternativeNames ?? [])]
  let best = {
    candidateName: candidate.name,
    normalizedCandidateName: canonicalizeName(candidate.name),
    similarity: 0,
  }

  for (const name of names) {
    const normalizedCandidateName = canonicalizeName(name)
    if (!normalizedAnchorName || !normalizedCandidateName) continue
    const similarity = diceSimilarity(normalizedAnchorName, normalizedCandidateName)
    if (similarity > best.similarity) {
      best = { candidateName: name, normalizedCandidateName, similarity }
    }
  }

  return { normalizedAnchorName, ...best }
}

export function distanceMeters(
  from: Pick<PlaceAnchor, 'latitude' | 'longitude'>,
  to: Pick<PlaceAnchor, 'latitude' | 'longitude'>,
): number {
  const radians = Math.PI / 180
  const lat1 = from.latitude * radians
  const lat2 = to.latitude * radians
  const deltaLat = (to.latitude - from.latitude) * radians
  const deltaLon = (to.longitude - from.longitude) * radians
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function scoreCandidate(
  anchor: PlaceAnchor,
  candidate: RawPlaceCandidate,
): PlaceMatchCandidate {
  const distance = distanceMeters(anchor, candidate)
  const proximity = Math.max(0, 1 - distance / MATCH_RADIUS_METERS)
  const nameMatch = bestNameMatch(anchor.name, candidate)
  const addressScore = addressSimilarity(anchor.address, candidate.address)
  const score =
    0.65 * nameMatch.similarity +
    0.25 * proximity +
    0.1 * addressScore

  return {
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    score: Number(score.toFixed(4)),
    distanceMeters: Number(distance.toFixed(1)),
    matchEvidence: {
      anchorName: anchor.name,
      candidateName: nameMatch.candidateName,
      normalizedAnchorName: nameMatch.normalizedAnchorName,
      normalizedCandidateName: nameMatch.normalizedCandidateName,
      nameSimilarity: Number(nameMatch.similarity.toFixed(4)),
      proximityScore: Number(proximity.toFixed(4)),
      addressSimilarity: Number(addressScore.toFixed(4)),
    },
    data: candidate.data,
  }
}

export async function matchPlace(
  provider: PlaceMatchProvider,
  anchor: PlaceAnchor,
): Promise<PlaceMatchResponse> {
  const candidates = (await provider.findCandidates(anchor))
    .map((candidate) => scoreCandidate(anchor, candidate))
    .filter((candidate) => candidate.distanceMeters <= MATCH_RADIUS_METERS)
    .sort((left, right) => right.score - left.score || left.distanceMeters - right.distanceMeters)
    .slice(0, 5)

  return {
    source: provider.source,
    matchMethod: 'spatial_name_v2',
    bestMatch:
      candidates[0] && candidates[0].score >= BEST_MATCH_THRESHOLD
        ? candidates[0]
        : null,
    candidates,
    attribution: provider.attribution,
  }
}
