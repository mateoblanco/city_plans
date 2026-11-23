import { cacheLife, cacheTag } from 'next/cache'
import { guidesWithPlace, type GuideLink } from './entries'
import { publishedGuides } from './published'

/**
 * "Aparece en estas guías" de la ficha: las guías publicadas (con página) que incluyen el lugar. Sólo datos de la base,
 * de la lista de guías ya cacheada. Cacheada por lugar: un minuto, tag 'guides'.
 */
export async function getPlaceGuides(placeId: string): Promise<GuideLink[]> {
  'use cache'
  cacheTag('guides')
  cacheLife('guides')
  return guidesWithPlace(await publishedGuides(), placeId)
}
