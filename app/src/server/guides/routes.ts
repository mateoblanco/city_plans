import { activeNeighborhoods, cityPath, guidePath, liveGuides, neighborhoodPath } from './catalog'
import { isPreviewKey, PREVIEW_PARAM, PREVIEW_PREFIX, previewPath } from './preview'
import type { Guide } from './types'

/** /guides todavía no es una página: redirige (307, temporal) a la ciudad. Más adelante, un selector de ciudades. */
export const GUIDES_HOME = '/guides'
export const GUIDES_HOME_TARGET = cityPath('montevideo')

/**
 * Las rutas que existen bajo /guides: la ciudad, cada barrio con página (con el mínimo de guías, activeNeighborhoods) y
 * cada guía con página en /guides/montevideo/<slug> (publicada y con algún lugar publicado: liveGuides). La usa el proxy
 * (con la lista cacheada de routes-cache.ts) para responder 404 real a todo lo demás, también a la vieja
 * /guides/montevideo/<barrio>/<slug>.
 */
export function guideRoutes(guides: readonly Guide[]): string[] {
  return [
    ...new Set([
      cityPath('montevideo'),
      ...[...activeNeighborhoods(guides)].map((id) => neighborhoodPath('montevideo', id)),
      ...liveGuides(guides).map(guidePath),
    ]),
  ]
}

const normalize = (pathname: string) => (pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname)

/** Si la ruta existe; una barra final no cuenta ("/guides/montevideo/cordon/" es la del barrio). */
export function isGuideRoute(pathname: string, routes: ReadonlySet<string>): boolean {
  return routes.has(normalize(pathname))
}

export type ProxyAction = { kind: 'next' } | { kind: 'redirect' } | { kind: 'notFound' } | { kind: 'preview'; path: string }

/**
 * Qué hace el proxy con un pedido a /guides/* o /guide-preview/*:
 * - /guide-preview/* directo: siempre 404 (sólo se llega reescrito desde una URL con la clave).
 * - /guides: redirigir a la ciudad.
 * - con ?preview=<clave correcta> y forma de guía: reescribir a la vista previa (también un borrador).
 * - si no, la lista de rutas: seguir o 404. Sin lista (la base falló y no hay una anterior), seguir: queda el
 *   notFound() de la página (200 + noindex), nunca un 404 de una ruta que existe.
 */
export function guideProxyAction(
  pathname: string,
  routes: ReadonlySet<string> | null,
  options: { preview?: string | null; secret?: string } = {},
): ProxyAction {
  if (pathname === PREVIEW_PREFIX || pathname.startsWith(`${PREVIEW_PREFIX}/`)) return { kind: 'notFound' }
  if (normalize(pathname) === GUIDES_HOME) return { kind: 'redirect' }
  if (options.preview != null && isPreviewKey(options.preview, options.secret)) {
    const path = previewPath(pathname)
    if (path) return { kind: 'preview', path }
  }
  if (!routes) return { kind: 'next' }
  return isGuideRoute(pathname, routes) ? { kind: 'next' } : { kind: 'notFound' }
}

export { PREVIEW_PARAM }
