import { cacheLife, cacheTag } from 'next/cache'
import { getSql } from '../db'
import { readGuides, readIntros } from './db'
import type { Guide } from './types'

const query = (text: string, params: unknown[]) => getSql().query(text, params) as Promise<unknown[]>

/**
 * Las guías publicadas de Montevideo (con sus lugares en orden, sin los datos de cada lugar). Cacheada por un minuto,
 * tag 'guides'. Sin webhook: lo que se publica en el backoffice aparece al revalidar.
 */
export async function publishedGuides(): Promise<Guide[]> {
  'use cache'
  cacheTag('guides')
  cacheLife('guides')
  return readGuides(query)
}

/** Las introducciones de la ciudad (clave null) y de cada barrio, como lista de pares (serializable para la cache). */
export async function guideIntros(): Promise<[string | null, string[]][]> {
  'use cache'
  cacheTag('guides')
  cacheLife('guides')
  return [...(await readIntros(query)).entries()]
}

/** Sin cache, para la vista previa: también los borradores. */
export const allGuidesUncached = () => readGuides(query, { drafts: true })
/** Lectura actual para el fallback de una ruta recién publicada mientras la caché de un minuto se actualiza. */
export const publishedGuidesUncached = () => readGuides(query)
export const introsUncached = async () => [...(await readIntros(query)).entries()]
