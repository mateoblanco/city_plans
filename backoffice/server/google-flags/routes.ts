import type { Hono } from 'hono'
import { z } from 'zod'
import type { GoogleFlagsStore } from './store.ts'

const MISSING_DATABASE = 'Falta configurar DATABASE_URL en .env.local.'
const apiError = (code: string, message: string) => ({ error: { code, message } })
const logError = (event: string, error: unknown) =>
  console.error(JSON.stringify({ event, message: error instanceof Error ? error.message : String(error) }))

/**
 * Lugares › Avisos de Google:
 * - GET /api/google-flags: avisos abiertos, cuántos publicados tienen coordenadas de más de 30 días y la última corrida.
 * - PATCH /api/google-flags/:id/ignored ({ ignored: true }): deja de mostrarlo.
 * - POST /api/google-flags/:id/unpublish: manda el lugar a "A revisar" con el motivo y cierra el aviso.
 */
export function registerGoogleFlagsRoutes(app: Hono, store: GoogleFlagsStore | undefined) {
  app.get('/api/google-flags', async (context) => {
    if (!store) return context.json(apiError('CONFIGURATION_ERROR', MISSING_DATABASE), 503)
    try {
      context.header('Cache-Control', 'no-store')
      return context.json(await store.list())
    } catch (error) {
      logError('google_flags_list_error', error)
      return context.json(apiError('UNKNOWN_ERROR', 'No se pudieron leer los avisos de Google.'), 500)
    }
  })

  app.patch('/api/google-flags/:id/ignored', async (context) => {
    if (!store) return context.json(apiError('CONFIGURATION_ERROR', MISSING_DATABASE), 503)
    const id = context.req.param('id')
    const parsed = z.object({ ignored: z.literal(true) }).safeParse(await context.req.json().catch(() => null))
    if (!z.uuid().safeParse(id).success || !parsed.success) {
      return context.json(apiError('VALIDATION_ERROR', 'El pedido para ignorar el aviso no es válido.'), 400)
    }
    try {
      if (!(await store.ignore(id))) return context.json(apiError('NOT_FOUND_ERROR', 'El aviso no existe o ya se resolvió.'), 404)
      return context.json({ id, ignored: true })
    } catch (error) {
      logError('google_flags_ignore_error', error)
      return context.json(apiError('UNKNOWN_ERROR', 'No se pudo ignorar el aviso.'), 500)
    }
  })

  app.post('/api/google-flags/:id/unpublish', async (context) => {
    if (!store) return context.json(apiError('CONFIGURATION_ERROR', MISSING_DATABASE), 503)
    const id = context.req.param('id')
    if (!z.uuid().safeParse(id).success) return context.json(apiError('VALIDATION_ERROR', 'El id del aviso no es válido.'), 400)
    try {
      const outcome = await store.unpublish(id)
      if (outcome === 'not_found') return context.json(apiError('NOT_FOUND_ERROR', 'El aviso no existe o ya se resolvió.'), 404)
      return context.json({ id, outcome })
    } catch (error) {
      logError('google_flags_unpublish_error', error)
      return context.json(apiError('UNKNOWN_ERROR', 'No se pudo despublicar el lugar.'), 500)
    }
  })
}
