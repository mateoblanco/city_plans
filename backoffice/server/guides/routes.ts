import type { Context, Hono } from 'hono'
import { z } from 'zod'
import {
  GUIDE_CITIES,
  GUIDE_GROUPS,
  GUIDE_SLUG_MAX,
  GUIDE_STATUSES,
  MIN_NEIGHBORHOOD_GUIDES,
  guideUrlPath,
  publishIssues,
  slugIssues,
  type GuideDraftInput,
  type PublishIssue,
} from '../../src/data/guides.ts'
import { GUIDE_COLORS, type GuideColor } from '../../src/data/guide-colors.ts'
import { NEIGHBORHOOD_NAMES } from '../../src/data/neighborhood-names.ts'
import type { GuideDetail, GuideInput, GuideSummary } from '../../src/types/guides.ts'
import { SlugTakenError, type GuidesStore, type PlaceRef } from './store.ts'
import { CandidatesError, findCandidates } from './candidates.ts'
import { registerGuideAiRoutes } from './ai-routes.ts'
import type { Generator } from './generate.ts'

const MISSING_DATABASE = 'Falta configurar DATABASE_URL en .env.local.'
export const MAX_GUIDE_PLACES = 40

const apiError = (code: string, message: string) => ({ error: { code, message } })
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

const neighborhoodId = z
  .string()
  .nullable()
  .refine((value) => value === null || Object.hasOwn(NEIGHBORHOOD_NAMES, value), 'Barrio desconocido.')

/** Los textos pueden venir vacíos (un borrador); lo obligatorio para publicar lo dice publishIssues. */
const guideSchema = z.object({
  slug: z.string().trim().max(GUIDE_SLUG_MAX),
  city: z.enum(GUIDE_CITIES),
  neighborhoodId,
  group: z.enum(GUIDE_GROUPS),
  title: z.string().trim().max(160),
  seoTitle: z.string().trim().max(160),
  seoDescription: z.string().trim().max(320),
  intro: z.string().trim().max(4000),
  featured: z.boolean(),
  // La franja de la tarjeta en la app. No es contenido: cambiarlo no mueve "Actualizada el…".
  color: z.enum(GUIDE_COLORS as [GuideColor, ...GuideColor[]], 'Color fuera de la paleta.'),
  places: z
    .array(z.object({ placeId: z.guid(), text: z.string().trim().max(1000) }))
    .max(MAX_GUIDE_PLACES)
    .refine((places) => new Set(places.map((place) => place.placeId)).size === places.length, 'Un lugar está repetido.'),
})

const saveSchema = z.object({ guide: guideSchema, keepDate: z.boolean().optional(), aiCostUsd: z.number().min(0).max(1000).optional() })
const featuredSchema = z.object({ featured: z.boolean() })
const introSchema = z.object({ city: z.enum(GUIDE_CITIES), neighborhoodId, intro: z.string().max(4000) })

export type GuideFilters = { status?: string; group?: string; neighborhood?: string; featured?: string }

/**
 * Filtros del listado: status y group por valor; neighborhood = un id, o "city" para las de toda la ciudad; featured
 * "1" / "0". Un valor vacío no filtra.
 */
export function filterGuides(guides: readonly GuideSummary[], filters: GuideFilters): GuideSummary[] {
  return guides.filter(
    (guide) =>
      (!filters.status || guide.status === filters.status) &&
      (!filters.group || guide.group === filters.group) &&
      (!filters.neighborhood || (filters.neighborhood === 'city' ? guide.neighborhoodId === null : guide.neighborhoodId === filters.neighborhood)) &&
      (!filters.featured || guide.featured === (filters.featured === '1')),
  )
}

const CONTENT_FIELDS = ['slug', 'city', 'neighborhoodId', 'group', 'title', 'seoTitle', 'seoDescription', 'intro'] as const

/** Si cambió algo que se ve en la guía (no featured): textos, barrio, grupo, slug, lugares, su orden o sus textos. */
export function contentChanged(before: GuideDetail, after: GuideInput): boolean {
  if (CONTENT_FIELDS.some((field) => before[field] !== after[field])) return true
  if (before.places.length !== after.places.length) return true
  return before.places.some((place, index) => place.placeId !== after.places[index].placeId || place.text !== after.places[index].text)
}

/** La guía como la mira publishIssues, con el status de cada lugar en places. */
const draftOf = (guide: GuideInput, refs: readonly PlaceRef[]): GuideDraftInput => {
  const status = new Map(refs.map((ref) => [ref.id, ref.status]))
  return { ...guide, places: guide.places.map((place) => ({ ...place, published: status.get(place.placeId) === 'published' })) }
}

const detailAsInput = (guide: GuideDetail): GuideInput => ({ ...guide, places: guide.places.map(({ placeId, text }) => ({ placeId, text })) })

export type GuideRoutesConfig = {
  /** La URL de la app: vista previa y búsqueda de candidatos (/api/search). */
  appUrl?: string
  secret?: string
  generator?: Generator
  balance?: () => Promise<number | null>
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
}

export function registerGuideRoutes(app: Hono, store: GuidesStore | undefined, preview: GuideRoutesConfig = {}) {
  const missing = (context: Context) => context.json(apiError('CONFIGURATION_ERROR', MISSING_DATABASE), 503)

  const fail = (context: Context, event: string, error: unknown, text: string) => {
    console.error(JSON.stringify({ event, message: message(error) }))
    return context.json(apiError('UNKNOWN_ERROR', text), 500)
  }

  const issuesResponse = (context: Context, code: 'PUBLISH_ISSUES' | 'VALIDATION_ERROR', issues: PublishIssue[], text: string) =>
    context.json({ ...apiError(code, text), issues }, 422)

  /** Valida el body de un guardado contra la base: slug, lugares existentes, duplicado y, si ya está publicada, publishIssues. */
  async function save(context: Context, id: string | undefined) {
    if (!store) return missing(context)
    const body = saveSchema.safeParse(await context.req.json().catch(() => null))
    if (!body.success) return context.json(apiError('VALIDATION_ERROR', body.error.issues[0]?.message ?? 'Datos inválidos.'), 400)
    const guide = body.data.guide
    try {
      const before = id ? await store.get(id) : null
      if (id && !before) return context.json(apiError('NOT_FOUND', 'No existe esa guía.'), 404)
      if (!guide.slug) return issuesResponse(context, 'VALIDATION_ERROR', [{ code: 'required', field: 'slug', message: 'Falta el slug.' }], 'Falta el slug.')
      const badSlug = slugIssues(guide.slug)
      if (badSlug.length > 0) return issuesResponse(context, 'VALIDATION_ERROR', badSlug, badSlug[0].message)
      if (await store.slugTaken(guide.city, guide.slug, id)) return context.json(apiError('SLUG_TAKEN', `Ya hay una guía con el slug "${guide.slug}" en la ciudad.`), 409)
      const refs = await store.places(guide.places.map((place) => place.placeId))
      if (refs.length !== guide.places.length) return context.json(apiError('VALIDATION_ERROR', 'Algún lugar ya no existe.'), 422)
      if (before?.status === 'published') {
        const issues = publishIssues(draftOf(guide, refs))
        if (issues.length > 0) return issuesResponse(context, 'PUBLISH_ISSUES', issues, 'Una guía publicada tiene que seguir cumpliendo lo necesario para publicar.')
      }
      const touchContent = !body.data.keepDate && (!before || contentChanged(before, guide))
      const savedId = await store.save(guide, { id, touchContent })
      // Lo gastado en IA antes de crear la guía (el editor lo acumula en memoria hasta el primer guardado).
      if (!id && body.data.aiCostUsd) await store.addAiCost(savedId, body.data.aiCostUsd)
      return context.json({ guide: await store.get(savedId) }, id ? 200 : 201)
    } catch (error) {
      if (error instanceof SlugTakenError) return context.json(apiError('SLUG_TAKEN', error.message), 409)
      return fail(context, 'guide_save_error', error, 'No se pudo guardar la guía.')
    }
  }

  // Antes de /api/guides/:id (si no, se leerían como un id).
  app.get('/api/guides/neighborhood-counts', async (context) => {
    if (!store) return missing(context)
    try {
      context.header('Cache-Control', 'no-store')
      return context.json({ min: MIN_NEIGHBORHOOD_GUIDES, counts: await store.neighborhoodGuideCounts() })
    } catch (error) {
      return fail(context, 'guide_neighborhood_counts_error', error, 'No se pudieron contar las guías por barrio.')
    }
  })


  registerGuideAiRoutes(app, store, { generator: preview.generator, balance: preview.balance })

  app.get('/api/guides', async (context) => {
    if (!store) return missing(context)
    try {
      const all = await store.list()
      const neighborhoods = [...new Set(all.flatMap((guide) => (guide.neighborhoodId ? [guide.neighborhoodId] : [])))].sort()
      context.header('Cache-Control', 'no-store')
      return context.json({ guides: filterGuides(all, context.req.query()), neighborhoods })
    } catch (error) {
      return fail(context, 'guides_list_error', error, 'No se pudieron leer las guías.')
    }
  })

  // Antes de /api/guides/:id para que "intros" no se lea como un id.
  app.get('/api/guides/intros', async (context) => {
    if (!store) return missing(context)
    try {
      context.header('Cache-Control', 'no-store')
      return context.json({ intros: await store.intros() })
    } catch (error) {
      return fail(context, 'guide_intros_error', error, 'No se pudieron leer las introducciones.')
    }
  })

  app.put('/api/guides/intros', async (context) => {
    if (!store) return missing(context)
    const body = introSchema.safeParse(await context.req.json().catch(() => null))
    if (!body.success) return context.json(apiError('VALIDATION_ERROR', body.error.issues[0]?.message ?? 'Datos inválidos.'), 400)
    try {
      await store.saveIntro(body.data.city, body.data.neighborhoodId, body.data.intro.trim())
      return context.json({ intros: await store.intros() })
    } catch (error) {
      return fail(context, 'guide_intro_save_error', error, 'No se pudo guardar la introducción.')
    }
  })

  app.get('/api/guides/:id', async (context) => {
    if (!store) return missing(context)
    try {
      const guide = await store.get(context.req.param('id'))
      if (!guide) return context.json(apiError('NOT_FOUND', 'No existe esa guía.'), 404)
      context.header('Cache-Control', 'no-store')
      return context.json({ guide })
    } catch (error) {
      return fail(context, 'guide_read_error', error, 'No se pudo leer la guía.')
    }
  })

  app.post('/api/guides', (context) => save(context, undefined))
  app.put('/api/guides/:id', (context) => save(context, context.req.param('id')))

  app.post('/api/guides/:id/publish', async (context) => {
    if (!store) return missing(context)
    try {
      const guide = await store.get(context.req.param('id'))
      if (!guide) return context.json(apiError('NOT_FOUND', 'No existe esa guía.'), 404)
      const input = detailAsInput(guide)
      const issues = publishIssues(draftOf(input, await store.places(input.places.map((place) => place.placeId))))
      if (issues.length > 0) return issuesResponse(context, 'PUBLISH_ISSUES', issues, 'Falta completar la guía para publicarla.')
      await store.setStatus(guide.id, 'published')
      return context.json({ guide: await store.get(guide.id) })
    } catch (error) {
      return fail(context, 'guide_publish_error', error, 'No se pudo publicar la guía.')
    }
  })

  app.post('/api/guides/:id/unpublish', async (context) => {
    if (!store) return missing(context)
    try {
      const id = context.req.param('id')
      if (!(await store.setStatus(id, GUIDE_STATUSES[0]))) return context.json(apiError('NOT_FOUND', 'No existe esa guía.'), 404)
      return context.json({ guide: await store.get(id) })
    } catch (error) {
      return fail(context, 'guide_unpublish_error', error, 'No se pudo despublicar la guía.')
    }
  })

  // Sólo borradores: una guía publicada se despublica antes (409). Sus lugares se borran con ella (cascade).
  app.delete('/api/guides/:id', async (context) => {
    if (!store) return missing(context)
    try {
      const result = await store.remove(context.req.param('id'))
      if (result === 'not_found') return context.json(apiError('NOT_FOUND', 'No existe esa guía.'), 404)
      if (result === 'published') return context.json(apiError('GUIDE_PUBLISHED', 'Una guía publicada no se puede eliminar: despublicala primero.'), 409)
      return context.json({ deleted: true })
    } catch (error) {
      return fail(context, 'guide_delete_error', error, 'No se pudo eliminar la guía.')
    }
  })

  app.patch('/api/guides/:id/featured', async (context) => {
    if (!store) return missing(context)
    const body = featuredSchema.safeParse(await context.req.json().catch(() => null))
    if (!body.success) return context.json(apiError('VALIDATION_ERROR', 'Falta featured.'), 400)
    try {
      if (!(await store.setFeatured(context.req.param('id'), body.data.featured))) return context.json(apiError('NOT_FOUND', 'No existe esa guía.'), 404)
      return context.json({ featured: body.data.featured })
    } catch (error) {
      return fail(context, 'guide_featured_error', error, 'No se pudo cambiar el destacado.')
    }
  })

  // La clave de la vista previa se agrega acá: nunca va al bundle del navegador.
  app.get('/api/guides/:id/preview-url', async (context) => {
    if (!store) return missing(context)
    const appUrl = preview.appUrl?.trim().replace(/\/+$/, '')
    const secret = preview.secret?.trim()
    if (!appUrl || !secret) return context.json(apiError('CONFIGURATION_ERROR', 'Falta configurar APP_URL y GUIDES_PREVIEW_SECRET en .env.local.'), 503)
    try {
      const guide = await store.get(context.req.param('id'))
      if (!guide) return context.json(apiError('NOT_FOUND', 'No existe esa guía.'), 404)
      if (!guide.slug) return context.json(apiError('VALIDATION_ERROR', 'La guía no tiene slug.'), 422)
      const url = `${appUrl}${guideUrlPath(guide)}?preview=${encodeURIComponent(secret)}`
      context.header('Cache-Control', 'no-store')
      return context.json({ url })
    } catch (error) {
      return fail(context, 'guide_preview_error', error, 'No se pudo armar la vista previa.')
    }
  })

  const candidateSchema = z.object({ idea: z.string().trim().min(2).max(200), neighborhoodId, group: z.enum(GUIDE_GROUPS) })

  // Antes de /api/guides/:id (POST con otro path, pero así queda junto a lo demás de la búsqueda).
  app.post('/api/guides/candidates', async (context) => {
    if (!store) return missing(context)
    const body = candidateSchema.safeParse(await context.req.json().catch(() => null))
    if (!body.success) return context.json(apiError('VALIDATION_ERROR', 'Escribí una idea de 2 a 200 caracteres.'), 400)
    try {
      const result = await findCandidates(body.data, { appUrl: preview.appUrl, extras: (ids) => store.candidateExtras(ids), fetch: preview.fetch })
      context.header('Cache-Control', 'no-store')
      return context.json(result)
    } catch (error) {
      if (error instanceof CandidatesError) return context.json(apiError(error.status === 503 ? 'CONFIGURATION_ERROR' : 'APP_SEARCH_ERROR', error.message), error.status)
      return fail(context, 'guide_candidates_error', error, 'No se pudieron buscar candidatos.')
    }
  })

}
