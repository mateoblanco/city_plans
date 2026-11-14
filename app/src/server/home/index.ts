import 'server-only'
import { after } from 'next/server'
import { getDb } from '../db'
import type { CardRow } from '../places/similar'
import { searchDeps } from '../search'
import type { HomeRow } from './assemble'
import { fixedSections, HOME_CONFIG, SLOT_SECTIONS } from './config'
import { homeDiscountRows } from './discounts'
import { homeNearRow } from './near'
import { layoutHome } from './layout'
import { homeForYouRow, homeSectionRows } from './rows'
import { homeSavedRow, savedPlacesQuery, type SavedDeps } from './saved'
import { createSwrCache } from './swr'
import { nextSlotStart, parseSlotKey, slotKey } from './slots'

export type { HomeRow } from './assemble'
export { DISCOUNT_ROW_PREFIX } from './discounts'
export { parseDevNow } from './dev-now'

/** Los pools de las filas cacheadas y cuándo se buscaron (desde ahí freshOpen saca los que cerraron). */
type CachedRows = { rows: HomeRow[]; computedAt: string }

/**
 * Arma los pools de las filas sin guardados (las de la franja de `key` y las de siempre), iguales para todos. Se busca
 * con la hora de ahora, o con el inicio de la franja si se precalienta antes de que empiece.
 */
async function loadSectionRows(key: string, at?: Date): Promise<CachedRows> {
  const { slot, start } = parseSlotKey(key)
  const when = at ?? new Date(Math.max(Date.now(), start.getTime()))
  const rows = await homeSectionRows(searchDeps(), [...SLOT_SECTIONS[slot], ...fixedSections(slot)], when)
  return { rows, computedAt: when.toISOString() }
}

/**
 * Caché de los pools con la fecha y la franja de Montevideo como clave (`slotKey`): al cambiar de franja es otra entrada
 * y nunca se ven filas de la anterior. Se sirve lo cacheado y se rearma en segundo plano (`after()`) cada
 * HOME_CONFIG.refreshMinutes como máximo, sin que nadie espere (home/swr.ts); por pedido, freshOpen saca los que cerraron
 * desde `computedAt`. En memoria del proceso: espera el primer pedido de un proceso nuevo.
 */
const sectionsCache = createSwrCache<CachedRows>({
  maxAgeMs: HOME_CONFIG.refreshMinutes * 60_000,
  schedule: (task) => after(task),
  onError: (error) => console.error('Falló la actualización de las filas de la home', error),
})

/**
 * En los últimos HOME_CONFIG.refreshMinutes de una franja, arma en segundo plano (después de responder) la entrada de la
 * siguiente, así el primero de la franja nueva no espera.
 */
function prewarmNextSlot(now: Date) {
  const next = nextSlotStart(now)
  if (next.getTime() - now.getTime() > HOME_CONFIG.refreshMinutes * 60_000) return
  const key = slotKey(next)
  sectionsCache.warm(key, () => loadSectionRows(key))
}

/** Las filas cacheadas de ahora; con `?now=` (sólo desarrollo), sin caché y a esa hora. */
function sectionRows(now: Date, simulated: boolean): Promise<CachedRows> {
  const key = slotKey(now)
  if (simulated) return loadSectionRows(key, now)
  prewarmNextSlot(now)
  return sectionsCache.get(key, () => loadSectionRows(key))
}

const savedDeps = (): SavedDeps => ({
  async savedPlaces(ids) {
    const { rows } = await getDb().execute(savedPlacesQuery(ids))
    return rows as CardRow[]
  },
})

/**
 * Las filas de la home con las cookies de la persona (sin caché: son suyas), en este orden: "Guardados" (todos, sin
 * filtrar), "Abierto ahora cerca tuyo" (con la ubicación de la cookie `loc`), las de la franja de ahora (hora de
 * Montevideo), "Para vos" (los guardados como señal de gustos), "Descuentos con <Banco>" (la cookie `cards`) y las de
 * siempre. Todas menos "Guardados" sólo con lugares abiertos ahora y, salvo "Para vos" y "cerca tuyo" (que manda la
 * distancia), reordenadas con la afinidad de "Para vos" (en memoria, sin otra consulta). Sin repetir lugares entre ellas
 * y sin las de menos de 4. Si falla una fila personal, la home sigue sin ella. `simulated`: la hora de `?now=` (sólo desarrollo).
 */
export async function homeRows(saved: string[], userLocation: string | null, cards: string[] = [], simulated: Date | null = null): Promise<HomeRow[]> {
  const deps = searchDeps()
  const now = simulated ?? new Date()
  const [savedRow, near, forYou, discountRows, cached] = await Promise.all([
    homeSavedRow(savedDeps(), saved, now).catch((error: unknown) => {
      console.error('Falló "Guardados" de la home', error)
      return null
    }),
    homeNearRow(deps, userLocation, now).catch((error: unknown) => {
      console.error('Falló "Abierto ahora cerca tuyo" de la home', error)
      return null
    }),
    homeForYouRow(deps, saved, now).catch((error: unknown) => {
      console.error('Falló "Para vos" de la home', error)
      return null
    }),
    homeDiscountRows(deps, cards, now),
    sectionRows(now, simulated !== null),
  ])
  return layoutHome({ saved: savedRow, near, forYou, discounts: discountRows, cached: cached.rows, since: new Date(cached.computedAt) }, now)
}
