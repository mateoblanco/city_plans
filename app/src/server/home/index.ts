import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { getDb } from '../db'
import type { CardRow } from '../places/similar'
import { searchDeps } from '../search'
import { montevideoDate } from '../search/hours'
import { assembleHomeWithSaved, type HomeRow } from './assemble'
import { homeNearRow } from './near'
import { homeForYouRow, homeSectionRows } from './rows'
import { homeSavedRow, savedPlacesQuery, type SavedDeps } from './saved'

export type { HomeRow } from './assemble'

/**
 * Filas sin perfil, cacheadas para todos: los lugares cambian sólo al publicar, pero las filas son "Abre hoy" y la card
 * muestra el estado de horario ("Abierto · cierra 23:00"), así que se renuevan cada 15 minutos en segundo plano. day (la
 * fecha de Montevideo) va en la clave de la caché: a la medianoche de Montevideo es otra entrada y nunca se sirve la
 * del día anterior.
 */
async function cachedSectionRows(day: string): Promise<HomeRow[]> {
  'use cache'
  cacheLife({ stale: 5 * 60, revalidate: 15 * 60, expire: 60 * 60 })
  cacheTag('home-sections', `home-sections:${day}`)
  return homeSectionRows(searchDeps())
}

const savedDeps = (): SavedDeps => ({
  async savedPlaces(ids) {
    const { rows } = await getDb().execute(savedPlacesQuery(ids))
    return rows as CardRow[]
  },
})

/**
 * Las filas de la home con las cookies de la persona (sin caché: son suyas): "Guardados" (todos), "Abierto ahora cerca
 * tuyo" (con la ubicación de la cookie `loc`), "Para vos" (los mismos guardados como señal de gustos, si arman perfil)
 * y las del config, sin repetir lugares entre estas tres y sin las de menos de 4. Si falla una fila personal, la home
 * sigue sin ella.
 */
export async function homeRows(saved: string[], userLocation: string | null): Promise<HomeRow[]> {
  const deps = searchDeps()
  const [savedRow, near, forYou, sections] = await Promise.all([
    homeSavedRow(savedDeps(), saved).catch((error: unknown) => {
      console.error('Falló "Guardados" de la home', error)
      return null
    }),
    homeNearRow(deps, userLocation).catch((error: unknown) => {
      console.error('Falló "Abierto ahora cerca tuyo" de la home', error)
      return null
    }),
    homeForYouRow(deps, saved).catch((error: unknown) => {
      console.error('Falló "Para vos" de la home', error)
      return null
    }),
    cachedSectionRows(montevideoDate()),
  ])
  return assembleHomeWithSaved(savedRow, [...(near ? [near] : []), ...(forYou ? [forYou] : []), ...sections])
}
