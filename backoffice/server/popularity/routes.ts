import type { Hono } from 'hono'
import type { PopularityReader } from './list.ts'

const MISSING_DATABASE = 'Falta configurar DATABASE_URL en .env.local.'

/** GET /api/popularity: por lugar, totales de 7 y 30 días por tipo y de dónde vinieron las vistas. */
export function registerPopularityRoutes(app: Hono, reader: PopularityReader | undefined) {
  app.get('/api/popularity', async (context) => {
    if (!reader) return context.json({ error: { code: 'CONFIGURATION_ERROR', message: MISSING_DATABASE } }, 503)
    try {
      const data = await reader.list()
      context.header('Cache-Control', 'no-store')
      return context.json(data)
    } catch (error) {
      console.error(JSON.stringify({ event: 'popularity_list_error', message: error instanceof Error ? error.message : String(error) }))
      return context.json({ error: { code: 'UNKNOWN_ERROR', message: 'No se pudo leer la popularidad.' } }, 500)
    }
  })
}
