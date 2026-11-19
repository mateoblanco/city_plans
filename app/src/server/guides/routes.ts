import { cityPath, guidePath, neighborhoodPath, visibleGuides } from './catalog'
import type { Guide } from './types'

/** /guides todavía no es una página: redirige (307, temporal) a la ciudad. Más adelante, un selector de ciudades. */
export const GUIDES_HOME = '/guides'
export const GUIDES_HOME_TARGET = cityPath('montevideo')

/**
 * Las rutas que existen bajo /guides, sacadas sólo del archivo (sin base): la ciudad, cada barrio con alguna guía
 * visible y cada guía visible (de barrio o de ciudad). En producción, sin borradores. La usa el proxy para responder 404
 * real a todo lo demás.
 */
export function guideRoutes(guides: readonly Guide[] = visibleGuides()): ReadonlySet<string> {
  return new Set([
    cityPath('montevideo'),
    ...guides.flatMap((guide) => [...(guide.neighborhood ? [neighborhoodPath(guide.city, guide.neighborhood)] : []), guidePath(guide)]),
  ])
}

const normalize = (pathname: string) => (pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname)

/** Si la ruta existe; una barra final no cuenta ("/guides/montevideo/cordon/" es la del barrio). */
export function isGuideRoute(pathname: string, routes: ReadonlySet<string>): boolean {
  return routes.has(normalize(pathname))
}

/** Qué hace el proxy con un pedido a /guides/*: seguir, redirigir /guides a la ciudad o 404 real. */
export function guideProxyAction(pathname: string, routes: ReadonlySet<string>): 'next' | 'redirect' | 'notFound' {
  if (normalize(pathname) === GUIDES_HOME) return 'redirect'
  return isGuideRoute(pathname, routes) ? 'next' : 'notFound'
}
