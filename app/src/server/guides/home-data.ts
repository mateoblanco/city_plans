import { cacheLife, cacheTag } from 'next/cache'
import { pickHomeGuides, type GuideLink } from './entries'
import { publishedGuides } from './published'

/**
 * La sección "Guías" de la home, igual para todos: de la lista de guías ya cacheada (sin consultas nuevas por pedido).
 * Cacheada como las páginas de guías: un minuto, tag 'guides'. Vacía: la sección no aparece.
 */
export async function getHomeGuides(): Promise<GuideLink[]> {
  'use cache'
  cacheTag('guides')
  cacheLife('guides')
  return pickHomeGuides(await publishedGuides())
}
