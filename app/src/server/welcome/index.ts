import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { getDb } from '../db'
import { normalizeQuery } from '../search/normalize'
import { pickWelcomePlaces } from './pick'
import { welcomeKind, welcomePlace, type WelcomePlace, type WelcomeRow } from './places'
import { welcomePoolQuery, welcomeSearchQuery } from './queries'

export type { WelcomePlace } from './places'

/** Mínimo de letras para buscar. */
export const WELCOME_SEARCH_MIN = 2

/** El pool de la grilla (los más prominentes, sin cadenas, uno por marca): cambia sólo al publicar. */
async function welcomePool(): Promise<WelcomeRow[]> {
  'use cache'
  cacheLife('hours')
  cacheTag('welcome-pool')
  const { rows } = await getDb().execute(welcomePoolQuery())
  return rows as WelcomeRow[]
}

/** La grilla de la bienvenida: un sorteo variado del pool cacheado (cada pedido, otra mezcla). */
export async function welcomePlaces(random = Math.random): Promise<WelcomePlace[]> {
  return pickWelcomePlaces(await welcomePool(), welcomeKind, undefined, random).map(welcomePlace)
}

async function cachedSearch(normalized: string): Promise<WelcomePlace[]> {
  'use cache'
  cacheLife('hours')
  cacheTag('welcome-search')
  const { rows } = await getDb().execute(welcomeSearchQuery(normalized))
  return (rows as WelcomeRow[]).map(welcomePlace)
}

/** El buscador de la bienvenida sobre los publicados: sin tildes ni mayúsculas, parcial. Vacío con menos de WELCOME_SEARCH_MIN letras. */
export async function searchWelcomePlaces(raw: string): Promise<WelcomePlace[]> {
  const normalized = normalizeQuery(raw)
  if (normalized.length < WELCOME_SEARCH_MIN) return []
  return cachedSearch(normalized)
}
