/**
 * Caché en memoria con stale-while-revalidate para las filas de la home. La de `'use cache'` no sirve: en producción el
 * handler en memoria de Next descarta la entrada al pasar `revalidate` y el próximo pedido espera
 * (`next/dist/server/lib/cache-handlers/default.js`; sólo `next dev` sirve lo vencido).
 *
 * - Sin entrada para la clave: se arma y se espera (el primer pedido de un proceso nuevo, o una franja que no se
 *   precalentó). Varios pedidos a la vez comparten la misma promesa.
 * - Con entrada más vieja que `maxAgeMs`: se devuelve igual y se rearma en segundo plano (`schedule`, `after()` en la
 *   app), una sola vez a la vez. Si falla, queda la anterior y se reintenta en el próximo pedido.
 * - `warm`: arma una clave en segundo plano si no está (precalentar la franja siguiente).
 * Se guardan como mucho `maxKeys` claves (la franja actual y la siguiente): las más viejas se descartan.
 */
export type SwrOptions = {
  maxAgeMs: number
  maxKeys?: number
  /** Corre la tarea después de responder (en la app, `after()` de next/server). */
  schedule: (task: () => Promise<void>) => void
  now?: () => number
  onError?: (error: unknown) => void
}

type Entry<T> = { value: T; at: number } | null

type Slot<T> = { entry: Entry<T>; pending: Promise<T> | null }

export function createSwrCache<T>({ maxAgeMs, maxKeys = 2, schedule, now = Date.now, onError = () => {} }: SwrOptions) {
  const slots = new Map<string, Slot<T>>()
  // Claves con una actualización encolada que todavía no empezó: no se encola otra.
  const queued = new Set<string>()

  const run = (key: string, load: () => Promise<T>): Promise<T> => {
    const slot = slots.get(key) ?? { entry: null, pending: null }
    if (slot.pending) return slot.pending
    const pending = load()
      .then((value) => {
        slot.entry = { value, at: now() }
        return value
      })
      .finally(() => {
        slot.pending = null
      })
    slot.pending = pending
    slots.delete(key)
    slots.set(key, slot)
    while (slots.size > maxKeys) slots.delete(slots.keys().next().value!)
    return pending
  }

  const refresh = (key: string, load: () => Promise<T>) => {
    if (queued.has(key) || slots.get(key)?.pending) return
    queued.add(key)
    schedule(async () => {
      try {
        await run(key, load)
      } catch (error) {
        onError(error)
      } finally {
        queued.delete(key)
      }
    })
  }

  return {
    /** El valor de la clave: lo cacheado aunque esté vencido (y se rearma atrás), o se arma si no hay. */
    async get(key: string, load: () => Promise<T>): Promise<T> {
      const slot = slots.get(key)
      if (!slot?.entry) return run(key, load)
      if (now() - slot.entry.at > maxAgeMs) refresh(key, load)
      return slot.entry.value
    },
    /** Arma la clave en segundo plano si todavía no está (ni se está armando). */
    warm(key: string, load: () => Promise<T>) {
      if (slots.get(key)?.entry) return
      refresh(key, load)
    },
    /** Sólo tests. */
    keys: () => [...slots.keys()],
  }
}
