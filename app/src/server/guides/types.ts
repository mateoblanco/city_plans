import type { IntentId } from '@shared/intents.ts'

/**
 * Una guía editorial: una lista ordenada de lugares elegidos a mano, con un texto por lugar. Por ahora vive en un archivo
 * del repo (server/guides/<ciudad>/<barrio>/<slug>.ts); todo es plano y serializable para que pasarla a la base sea
 * directo: una tabla `guides` con estos campos y otra `guide_places (guide, position, place_id, text, photo)`.
 */

/** El grupo de la guía: una de las intenciones de la barra (Comer, Cafés, Tomar algo, Postres). La etiqueta sale de ahí. */
export type GuideGroup = Extract<IntentId, 'eat' | 'cafes' | 'bars' | 'desserts'>

/** Foto propia del lugar en la guía (opcional; hoy ninguna tiene). `src` es una URL del origen de LOGO_BASE_URL o de /public. */
export type GuidePhoto = { src: string; alt: string; width: number; height: number }

export type GuidePlaceEntry = {
  /** El id (uuid) del lugar en la tabla places. Si no está publicado, no sale y la numeración se recalcula. */
  id: string
  /** 2–3 líneas: por qué está en la guía. */
  text: string
  photo?: GuidePhoto
}

export type Guide = {
  /**
   * Último tramo de la URL: /guides/montevideo/<barrio>/<slug> o, sin barrio, /guides/montevideo/<slug>. El de una guía
   * de ciudad no puede ser el de un barrio (lo verifica catalog.test.ts): la ruta resuelve primero el barrio.
   */
  slug: string
  city: 'montevideo'
  /**
   * neighborhood_id de la base (el del shapefile, ej. 'CORDON'); el tramo de la URL sale del nombre (cordon). Sin
   * barrio, es una guía de toda la ciudad.
   */
  neighborhood?: string
  group: GuideGroup
  /** El título grande de la página. */
  title: string
  /** <title> y título para Google y redes. */
  seoTitle: string
  /** Meta description (hasta ~155 caracteres). */
  seoDescription: string
  /** La introducción, un string por párrafo. */
  intro: string[]
  /** Fecha de la última actualización del contenido: YYYY-MM-DD. */
  updatedAt: string
  /** En el orden en que se muestran. */
  places: GuidePlaceEntry[]
  /** Destacada en /guides/montevideo (si su grupo no tiene ninguna, van las más recientes). */
  featured?: boolean
  /** Portada de la tarjeta en la página del barrio (ilustración o foto; opcional, hoy ninguna tiene). */
  cover?: GuidePhoto
  /**
   * Borrador: sólo se ve con `next dev` (NODE_ENV=development). En producción no existe: ni página, ni tarjeta en el
   * barrio, ni sitemap. Sirve para probar el diseño con varias guías.
   */
  draft?: boolean
}

/** Lo propio de la página de un barrio (/guides/montevideo/<barrio>): la introducción y lo que ve Google. */
export type GuideNeighborhood = {
  /** neighborhood_id de la base ('CORDON'). */
  neighborhood: string
  city: 'montevideo'
  /** Un string por párrafo; corto. */
  intro: string[]
  seoTitle: string
  seoDescription: string
}

/** Lo propio de la página de una ciudad (/guides/montevideo): el título, la introducción y lo que ve Google. */
export type GuideCity = {
  city: 'montevideo'
  /** "Guías de Montevideo": el h1 y el primer tramo de las migas. */
  title: string
  intro: string[]
  seoTitle: string
  seoDescription: string
}
