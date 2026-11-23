import type { GuideColor } from '../data/guide-colors.ts'
import type { GuideCity, GuideGroup, GuideStatus, PublishIssue } from '../data/guides.ts'

export type GuideWarning =
  | { code: 'unpublished_places'; places: string[] }
  | { code: 'stale'; months: number }

/** Una fila del listado de guías. Fechas en ISO (UTC). */
export type GuideSummary = {
  id: string
  slug: string
  city: GuideCity
  /** null = de toda la ciudad. */
  neighborhoodId: string | null
  group: GuideGroup
  title: string
  status: GuideStatus
  featured: boolean
  placeCount: number
  publishedAt: string | null
  contentUpdatedAt: string
  warnings: GuideWarning[]
}

export type GuideListResponse = {
  guides: GuideSummary[]
  /** Los barrios que tienen alguna guía (para el filtro). */
  neighborhoods: string[]
}

/** Un lugar de la guía, en su orden, con lo que hace falta para mostrarlo en el editor. */
export type GuidePlaceDetail = {
  placeId: string
  text: string
  name: string
  slug: string
  neighborhoodId: string | null
  /** Status del lugar en places: si no es 'published', la app lo saltea. */
  status: string
}

export type GuideDetail = {
  id: string
  slug: string
  city: GuideCity
  neighborhoodId: string | null
  group: GuideGroup
  title: string
  seoTitle: string
  seoDescription: string
  intro: string
  status: GuideStatus
  featured: boolean
  /** La franja de la tarjeta en la app. */
  color: GuideColor
  publishedAt: string | null
  contentUpdatedAt: string
  /** Lo gastado en IA en esta guía (USD). */
  aiCostUsd: number
  places: GuidePlaceDetail[]
}

/** Lo que manda el editor al guardar. */
export type GuideInput = {
  slug: string
  city: GuideCity
  neighborhoodId: string | null
  group: GuideGroup
  title: string
  seoTitle: string
  seoDescription: string
  intro: string
  featured: boolean
  color: GuideColor
  places: { placeId: string; text: string }[]
}

export type GuideSaveRequest = {
  guide: GuideInput
  /** "Sólo corrección": no cambia la fecha de actualización. */
  keepDate?: boolean
  /** Sólo al crear: lo gastado en IA antes de guardar la guía por primera vez. */
  aiCostUsd?: number
}

export type GuideResponse = { guide: GuideDetail }

export type GuideIssuesError = { error: { code: 'PUBLISH_ISSUES' | 'VALIDATION_ERROR'; message: string }; issues: PublishIssue[] }

export type GuideIntro = {
  city: GuideCity
  /** null = la página de la ciudad. */
  neighborhoodId: string | null
  intro: string
  updatedAt: string
}

export type GuideIntrosResponse = { intros: GuideIntro[] }

export type GuidePreviewUrlResponse = { url: string }

/** Un candidato de "Buscar lugares": lo de /api/search de la app más tags y descripción de la base. */
export type GuideCandidate = {
  id: string
  name: string
  /** neighborhood_id ('CORDON'). */
  neighborhood: string
  categories: string[]
  iconCategory: string | null
  logoUrl: string | null
  logoBgColor: string | null
  /** Por qué apareció: los motivos que ya calcula la búsqueda. */
  reasons: string[]
  tags: string[]
  description: string | null
}

export type GuideCandidatesResponse = {
  candidates: GuideCandidate[]
  /** Avisos de la búsqueda (lo que relajó). */
  notices: string[]
}

export type GuideGenerateKind = 'title' | 'seo' | 'intro' | 'place' | 'places-empty' | 'neighborhood-intro' | 'city-intro'

/** Lo del formulario que necesita la generación (los datos de los lugares los lee el servidor de la base). */
export type GuideGenerateDraft = {
  idea: string
  title: string
  intro: string
  neighborhoodId: string | null
  group: GuideGroup
  places: { placeId: string; text: string }[]
}

export type GuideGenerateRequest = {
  kind: GuideGenerateKind
  /** Con una guía guardada, el costo se suma a su total en la base. */
  guideId?: string | null
  draft?: GuideGenerateDraft
  placeId?: string
  /** Para neighborhood-intro. */
  neighborhoodId?: string
}

export type GuideGeneratedValue =
  | { kind: 'title'; title: string }
  | { kind: 'seo'; seoTitle: string; seoDescription: string }
  | { kind: 'intro'; intro: string }
  | { kind: 'place'; placeId: string; text: string }
  | { kind: 'places-empty'; texts: { placeId: string; text: string }[]; errors: { placeId: string; message: string }[] }
  | { kind: 'area-intro'; intro: string }

export type GuideGenerateResponse = {
  value: GuideGeneratedValue
  costUsd: number
  /** El total gastado en IA en la guía (guardado), o null si la guía no está guardada. */
  guideCostUsd: number | null
}

/** Guías que cuentan para la página de cada barrio (publicadas con algún lugar publicado) y el mínimo. */
export type GuideNeighborhoodCountsResponse = { min: number; counts: Record<string, number> }

export type GuideAiStatusResponse = { model: string; balanceUsd: number | null; creditUrl: string }
