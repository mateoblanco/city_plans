import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { searchDeps } from '../search'
import { montevideoDate } from '../search/hours'
import { assembleHome, type HomeRow } from './assemble'
import { homeForYouRow, homeSectionRows } from './rows'

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

/** Las filas de la home: "Para vos" (si hay perfil) y las del config, sin repetir lugares y sin las de menos de 4. */
export async function homeRows(likes: string[]): Promise<HomeRow[]> {
  const deps = searchDeps()
  const [forYou, sections] = await Promise.all([
    homeForYouRow(deps, likes).catch((error: unknown) => {
      // Sin "Para vos" la home sigue.
      console.error('Falló "Para vos" de la home', error)
      return null
    }),
    cachedSectionRows(montevideoDate()),
  ])
  return assembleHome([...(forYou ? [forYou] : []), ...sections])
}
