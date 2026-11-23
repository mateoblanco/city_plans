import type { RemoteStore } from '../search/runtime-cache'
import { createSwrCache, type SwrRemote } from '../home/swr'

/**
 * Los slugs de las fichas publicadas, para que el proxy responda 404 real a /place/<slug> que no existe o no está
 * publicado (con cacheComponents, el shell de la página sale con 200 antes del notFound(): soft 404). Sin consultar la
 * base en cada pedido: `createSwrCache` (el de la home y las rutas de guías), memoria de la instancia → Runtime Cache de
 * Vercel (compartida entre instancias; sólo en Vercel) → la base. Dura un minuto; vencida, se responde con la vieja y se
 * rearma en segundo plano (stale-while-revalidate, con waitUntil): ningún pedido espera la base salvo el primero de una
 * instancia nueva. Publicar tarda hasta un minuto (más el pedido que dispara el rearmado) en dejar de dar 404.
 * La base falla sin lista: null (el proxy deja pasar y queda el notFound() de la página); con lista vieja, la vieja.
 */
export const PLACE_SLUGS_MAX_AGE_MS = 60 * 1000

const KEY = 'slugs'

// El mismo formato que isValidSlug (server/places/place.ts), sin importar la base en el proxy.
const SLUG = /^[a-z0-9-]{1,200}$/

export type PlaceSlugsCacheOptions = {
  load: () => Promise<string[]>
  remote?: RemoteStore | null
  now?: () => number
  onError?: (error: unknown) => void
}

const readSlugs = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((slug) => typeof slug === 'string' && SLUG.test(slug)) ? (value as string[]) : null

export function createPlaceSlugsCache({ load, remote = null, now = Date.now, onError = () => {} }: PlaceSlugsCacheOptions) {
  let background: Promise<unknown>[] = []
  const keep = (promise: Promise<unknown>) => {
    background.push(promise)
  }
  const swrRemote: SwrRemote<string[]> | null = remote
    ? {
        store: remote,
        key: () => `places:slugs:v1:${process.env.VERCEL_DEPLOYMENT_ID ?? 'local'}`,
        read: readSlugs,
        ttlSeconds: 5 * 60,
        timeoutMs: 300,
        name: 'place-slugs',
        tags: ['place-slugs'],
        background: keep,
      }
    : null
  const cache = createSwrCache<string[]>({
    maxAgeMs: PLACE_SLUGS_MAX_AGE_MS,
    maxKeys: 1,
    // Vencida no se espera: medido en local, rearmar antes de responder sumaba ~180 ms a un pedido por minuto.
    blockOnStale: false,
    schedule: (task) => keep(task()),
    remote: swrRemote,
    now,
    onError,
  })

  return {
    /** Los slugs (o null si no se pudieron leer) y la tarea de segundo plano que haya quedado, para waitUntil. */
    async slugs(): Promise<{ slugs: ReadonlySet<string> | null; background: Promise<unknown> | null }> {
      let slugs: ReadonlySet<string> | null = null
      try {
        slugs = new Set(await cache.get(KEY, load))
      } catch (error) {
        onError(error)
      }
      const pending = background
      background = []
      return { slugs, background: pending.length > 0 ? Promise.allSettled(pending) : null }
    },
  }
}

/** /place/<slug> de un solo segmento; cualquier otra cosa bajo /place no es una ficha. */
export function placeSlugOf(pathname: string): string | null {
  const match = /^\/place\/([^/]+)\/?$/.exec(pathname)
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return ''
  }
}

/**
 * Qué hace el proxy con /place/*: 404 si el slug es inválido o no está entre los publicados; sin lista (la base falló),
 * deja pasar. Un slug inválido no necesita la lista.
 */
export function placeProxyAction(pathname: string, slugs: ReadonlySet<string> | null): 'next' | 'notFound' {
  const slug = placeSlugOf(pathname)
  if (slug === null || !SLUG.test(slug)) return 'notFound'
  if (!slugs) return 'next'
  return slugs.has(slug) ? 'next' : 'notFound'
}
