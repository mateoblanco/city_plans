import type { GuideGroup } from '../../src/data/guides.ts'
import type { GuideCandidate, GuideCandidatesResponse } from '../../src/types/guides.ts'

/**
 * Candidatos para una guía desde una idea: el mismo motor de búsqueda de la app (diccionario + interpretación con LLM +
 * embeddings), con el GET /api/search público que ya existe, llamado desde el servidor del backoffice. Nada de la
 * persona: sin cookies (ni ubicación, ni guardados), `loc=all`, `profile=off` y sin filtro de horario. El barrio (o toda
 * la ciudad) y el grupo de la guía van como filtro e intención; el barrio nunca se relaja en el motor.
 */
export const CANDIDATES_MAX = 30

export type CandidateQuery = { idea: string; neighborhoodId: string | null; group: GuideGroup }

/** La URL de /api/search: q, intent = grupo, f = barrio (o nada: toda la ciudad), loc=all y profile=off. Nada más. */
export function searchUrl(appUrl: string, query: CandidateQuery): string {
  const params = new URLSearchParams({ q: query.idea.trim(), intent: query.group, loc: 'all', profile: 'off' })
  if (query.neighborhoodId) params.set('f', `neighborhood:${query.neighborhoodId}`)
  return `${appUrl.replace(/\/+$/, '')}/api/search?${params}`
}

/** Lo que se usa de un resultado de /api/search (SearchResult de la app). */
type SearchResultLike = {
  id: string
  name: string
  neighborhood: string
  categories: string[]
  iconCategory: string | null
  logoUrl: string | null
  logoBgColor: string | null
  reasons: string[]
}

type SearchResponseLike = { results?: SearchResultLike[]; relaxed?: { message: string }[] }

/** Lo que la búsqueda no trae y sí la base del backoffice. */
export type CandidateExtra = { id: string; tags: string[]; descriptionEs: string | null }

export class CandidatesError extends Error {
  readonly status: 502 | 503
  constructor(status: 502 | 503, message: string) {
    super(message)
    this.status = status
  }
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

/**
 * Busca en la app y suma tags y descripción de la base. /api/search no pagina: devuelve en `results` todos los que pasan
 * el corte por relevancia (la app los muestra de a 12 en el cliente), así que alcanza con un pedido; se toman los
 * primeros CANDIDATES_MAX. "Cerca de <barrio>" (`nearby`, fuera del barrio) y "Para vos" no se usan.
 */
export async function findCandidates(
  query: CandidateQuery,
  deps: { appUrl: string | undefined; extras: (ids: string[]) => Promise<CandidateExtra[]>; fetch?: Fetch; timeoutMs?: number },
): Promise<GuideCandidatesResponse> {
  const appUrl = deps.appUrl?.trim()
  if (!appUrl) throw new CandidatesError(503, 'Falta configurar APP_URL en .env.local (la URL de la app, para usar su búsqueda).')
  const fetcher = deps.fetch ?? fetch
  let data: SearchResponseLike
  try {
    const response = await fetcher(searchUrl(appUrl, query), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(deps.timeoutMs ?? 30_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    data = (await response.json()) as SearchResponseLike
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new CandidatesError(502, `No se pudo buscar en la app (¿está corriendo en ${appUrl}?): ${detail}`)
  }
  const results = (data.results ?? []).slice(0, CANDIDATES_MAX)
  const extras = new Map((await deps.extras(results.map((result) => result.id))).map((extra) => [extra.id, extra]))
  const candidates: GuideCandidate[] = results.map((result) => ({
    id: result.id,
    name: result.name,
    neighborhood: result.neighborhood,
    categories: result.categories,
    iconCategory: result.iconCategory,
    logoUrl: result.logoUrl,
    logoBgColor: result.logoBgColor,
    reasons: result.reasons ?? [],
    tags: extras.get(result.id)?.tags ?? [],
    description: extras.get(result.id)?.descriptionEs ?? null,
  }))
  return { candidates, notices: (data.relaxed ?? []).map((notice) => notice.message) }
}
