import type { RemoteStore } from '../search/runtime-cache'
import { createSwrCache, type SwrRemote } from '../home/swr'

/**
 * La lista de rutas de /guides para el proxy, sin ir a la base en cada pedido. Dura un minuto, como las guías. Al
 * vencer se rearma antes de responder: publicar o despublicar no deja una primera visita con un 404 viejo.
 * `createSwrCache` (el de la home): memoria de la instancia → Runtime
 * Cache de Vercel (compartida entre instancias; sólo en Vercel) → la base.
 * - Instancia nueva: una consulta, que esperan juntos los pedidos que llegan mientras tanto.
 * - Vencida: espera la lista nueva, una sola consulta para los pedidos que llegan juntos.
 * - La base falla sin lista: null (el proxy deja pasar); con lista vieja, queda la vieja y se reintenta.
 */
export const GUIDE_ROUTES_MAX_AGE_MS = 60 * 1000

const KEY = 'routes'

export type GuideRoutesCacheOptions = {
  load: () => Promise<string[]>
  remote?: RemoteStore | null
  now?: () => number
  onError?: (error: unknown) => void
}

const readRoutes = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((route) => typeof route === 'string' && route.startsWith('/guides')) ? (value as string[]) : null

export function createGuideRoutesCache({ load, remote = null, now = Date.now, onError = () => {} }: GuideRoutesCacheOptions) {
  // Lo que el cache encola para después de responder; el proxy lo pasa a event.waitUntil.
  let background: Promise<unknown>[] = []
  const keep = (promise: Promise<unknown>) => {
    background.push(promise)
  }
  const swrRemote: SwrRemote<string[]> | null = remote
    ? {
        store: remote,
        key: () => `guides:routes:v1:${process.env.VERCEL_DEPLOYMENT_ID ?? 'local'}`,
        read: readRoutes,
        ttlSeconds: 5 * 60,
        timeoutMs: 300,
        name: 'guide-routes',
        tags: ['guides'],
        background: keep,
      }
    : null
  const cache = createSwrCache<string[]>({
    maxAgeMs: GUIDE_ROUTES_MAX_AGE_MS,
    maxKeys: 1,
    blockOnStale: true,
    schedule: (task) => keep(task()),
    remote: swrRemote,
    now,
    onError,
  })

  return {
    /** Las rutas (o null si no se pudieron leer nunca) y la tarea de segundo plano que haya quedado, para waitUntil. */
    async routes(): Promise<{ routes: ReadonlySet<string> | null; background: Promise<unknown> | null }> {
      let routes: ReadonlySet<string> | null = null
      try {
        routes = new Set(await cache.get(KEY, load))
      } catch (error) {
        onError(error)
      }
      const pending = background
      background = []
      return { routes, background: pending.length > 0 ? Promise.allSettled(pending) : null }
    },
  }
}
