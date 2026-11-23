import type { GuideGroup as SharedGuideGroup } from '@shared/guides.ts'

/**
 * Una guía editorial: una lista ordenada de lugares elegidos a mano, con un texto por lugar. Vive en la base (tablas
 * `guides` y `guide_places`, las escribe el backoffice) y se lee con db.ts. Nada de esto está en archivos del repo.
 */

/** El grupo de la guía: una de las intenciones de la barra (Comer, Tomar algo, Cafés, Postres). La etiqueta sale de ahí. */
export type GuideGroup = SharedGuideGroup

/** Foto propia (de un lugar o portada de la tarjeta). La base todavía no las tiene: el espacio del diseño queda vacío. */
export type GuidePhoto = { src: string; alt: string; width: number; height: number }

export type GuidePlaceEntry = {
  /** El id (uuid) del lugar en la tabla places. Si no está publicado, no sale y la numeración se recalcula. */
  id: string
  /** 2–3 líneas: por qué está en la guía. */
  text: string
  photo?: GuidePhoto
}

export type Guide = {
  id: string
  /**
   * Último tramo de la URL: /guides/montevideo/<barrio>/<slug> o, sin barrio, /guides/montevideo/<slug>. Único en la
   * ciudad y nunca el de un barrio (lo valida el backoffice): la ruta resuelve primero el barrio.
   */
  slug: string
  city: 'montevideo'
  /** neighborhood_id de la base ('CORDON'); el tramo de la URL sale del nombre (cordon). null: toda la ciudad. */
  neighborhood: string | null
  group: GuideGroup
  /** El título grande de la página. */
  title: string
  /** <title> y título para Google y redes. */
  seoTitle: string
  seoDescription: string
  /** La introducción, un string por párrafo. */
  intro: string[]
  /** Fecha de la última actualización del contenido en Montevideo: YYYY-MM-DD. */
  updatedAt: string
  /** En el orden en que se muestran. */
  places: GuidePlaceEntry[]
  /** Destacada en /guides/montevideo (si su grupo no tiene ninguna, van las más recientes). */
  featured: boolean
  /** La franja de su tarjeta (un hex de /shared/guide-colors.ts, elegido en el backoffice). */
  color: string
  /** Borrador: sólo se lee en la vista previa (con la clave). Nunca tiene página, tarjeta ni sitemap. */
  draft: boolean
  /** Si tiene al menos un lugar publicado (sin ninguno, su página quedaría vacía: no existe). */
  live: boolean
  /** Cuántos de sus lugares están publicados (los que se ven en su página). */
  publishedPlaces: number
  cover?: GuidePhoto
}
