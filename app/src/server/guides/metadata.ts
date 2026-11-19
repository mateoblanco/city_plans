import type { Metadata } from 'next'
import { guidePath } from './catalog'
import { getNeighborhoodPage } from './neighborhood-data'
import type { Guide } from './types'

/** Metadata de una guía (de barrio o de ciudad): sólo el archivo, nada de la base ni de Google. */
export function guideMetadata(guide: Guide): Metadata {
  const url = guidePath(guide)
  return {
    title: guide.seoTitle,
    description: guide.seoDescription,
    alternates: { canonical: url },
    openGraph: { type: 'article', locale: 'es_UY', siteName: 'Salimos', url, title: guide.title, description: guide.seoDescription },
    twitter: { card: 'summary', title: guide.title, description: guide.seoDescription },
    // Un borrador (sólo existe en desarrollo) nunca se indexa.
    ...(guide.draft ? { robots: { index: false, follow: false } } : {}),
  }
}

/** Metadata de un barrio (de getNeighborhoodPage, cacheado); null si no tiene página. */
export async function neighborhoodMetadata(barrio: string): Promise<Metadata | null> {
  const data = await getNeighborhoodPage(barrio)
  if (!data) return null
  return {
    title: data.seoTitle,
    description: data.seoDescription,
    alternates: { canonical: data.path },
    openGraph: { type: 'website', locale: 'es_UY', siteName: 'Salimos', url: data.path, title: `Guías de ${data.name}`, description: data.seoDescription },
    twitter: { card: 'summary', title: `Guías de ${data.name}`, description: data.seoDescription },
  }
}
