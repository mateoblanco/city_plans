import type { RemoteStore } from '../search/runtime-cache'
import { withTimeout } from '../search/runtime-cache'

/**
 * Caché con stale-while-revalidate para las filas de la home, en dos capas: memoria de la instancia y, en Vercel, Runtime
 * Cache (compartida entre instancias de la región). La de `'use cache'` no sirve: en producción el handler en memoria de
 * Next descarta la entrada al pasar `revalidate` y el próximo pedido espera (`next/dist/server/lib/cache-handlers/default.js`;
 * sólo `next dev` sirve lo vencido).
 *
 * - Sin entrada en memoria: memoria → remota → armar. Lo de la remota se usa aunque esté vencido (y se rearma atrás), así
 *   una instancia nueva arranca con lo que armó otra; si tampoco está, se arma y se espera (y se guarda en la remota).
 *   Varios pedidos a la vez comparten la misma promesa.
 * - Con entrada más vieja que `maxAgeMs`: se devuelve igual y se rearma en segundo plano (`schedule`, `after()` en la
 *   app), una sola vez a la vez. Al rearmar se mira antes la remota: si otra instancia ya la actualizó, se usa esa sin ir
 *   a la base. Si falla, queda la anterior y se reintenta en el próximo pedido.
 * - `warm`: arma una clave en segundo plano si no está (precalentar la franja siguiente).
 * - Memoria acotada: como mucho `maxKeys` claves (la franja actual y la siguiente); las más viejas se descartan. La
 *   remota vence sola (`remote.ttlSeconds`).
 * Un remoto lento (más de `remote.timeoutMs`) o caído cuenta como que no estaba.
 */
export type SwrRemote<T> = {
  store: RemoteStore
  /** La clave en la remota (con versión y deploy: lo guardado por otro build no se lee). */
  key: (key: string) => string
  /** Valida lo leído de la remota; null si no sirve. */
  read: (value: unknown) => T | null
  ttlSeconds: number
  timeoutMs: number
  name: string
  tags: string[]
  /** Para no frenar la respuesta con la escritura (waitUntil en Vercel). */
  background: (promise: Promise<unknown>) => void
}

export type SwrOptions<T> = {
  maxAgeMs: number
  maxKeys?: number
  /** Con true, una entrada vencida se rearma antes de responder; por defecto se usa stale-while-revalidate. */
  blockOnStale?: boolean
  /** Corre la tarea después de responder (en la app, `after()` de next/server). */
  schedule: (task: () => Promise<void>) => void
  remote?: SwrRemote<T> | null
  now?: () => number
  onError?: (error: unknown) => void
}

type Entry<T> = { value: T; at: number }

type Slot<T> = { entry: Entry<T> | null; pending: Promise<Entry<T>> | null }

/** Lo que se guarda en la remota: el valor y cuándo se armó. */
type Stored = { v: unknown; at: number }

export function createSwrCache<T>({ maxAgeMs, maxKeys = 2, blockOnStale = false, schedule, remote = null, now = Date.now, onError = () => {} }: SwrOptions<T>) {
  const slots = new Map<string, Slot<T>>()
  // Claves con una actualización encolada que todavía no empezó: no se encola otra.
  const queued = new Set<string>()

  const fromRemote = async (key: string): Promise<Entry<T> | null> => {
    if (!remote) return null
    const stored = await withTimeout(Promise.resolve().then(() => remote.store.get(remote.key(key))), remote.timeoutMs)
    if (!stored || typeof stored !== 'object') return null
    const { v, at } = stored as Partial<Stored>
    const value = typeof at === 'number' ? remote.read(v) : null
    return value === null ? null : { value, at: at! }
  }

  const toRemote = (key: string, entry: Entry<T>) => {
    if (!remote) return
    const stored: Stored = { v: entry.value, at: entry.at }
    remote.background(
      Promise.resolve()
        .then(() => remote.store.set(remote.key(key), stored, { ttl: remote.ttlSeconds, tags: remote.tags, name: remote.name }))
        .catch(onError),
    )
  }

  /** remota → armar. `stale`: lo de la remota sirve aunque esté vencido (primer pedido); al rearmar, sólo si está al día. */
  const fetchEntry = async (key: string, load: () => Promise<T>, stale: boolean): Promise<Entry<T>> => {
    const stored = await fromRemote(key)
    if (stored && (stale || now() - stored.at <= maxAgeMs)) return stored
    const entry = { value: await load(), at: now() }
    toRemote(key, entry)
    return entry
  }

  const run = (key: string, load: () => Promise<T>, stale: boolean): Promise<Entry<T>> => {
    const slot = slots.get(key) ?? { entry: null, pending: null }
    if (slot.pending) return slot.pending
    const pending = fetchEntry(key, load, stale)
      .then((entry) => {
        slot.entry = entry
        return entry
      })
      .finally(() => {
        slot.pending = null
      })
    slot.pending = pending
    // Map recuerda el orden de inserción: reinsertar la deja como la más reciente y se descartan las más viejas.
    slots.delete(key)
    slots.set(key, slot)
    while (slots.size > maxKeys) slots.delete(slots.keys().next().value!)
    return pending
  }

  const refresh = (key: string, load: () => Promise<T>, stale: boolean) => {
    if (queued.has(key) || slots.get(key)?.pending) return
    queued.add(key)
    schedule(async () => {
      try {
        await run(key, load, stale)
      } catch (error) {
        onError(error)
      } finally {
        queued.delete(key)
      }
    })
  }

  return {
    /** El valor de la clave: por defecto stale-while-revalidate; `blockOnStale` espera el valor nuevo antes de responder. */
    async get(key: string, load: () => Promise<T>): Promise<T> {
      const entry = slots.get(key)?.entry ?? (await run(key, load, true))
      if (now() - entry.at > maxAgeMs) {
        if (blockOnStale) return (await run(key, load, false)).value
        refresh(key, load, false)
      }
      return entry.value
    },
    /** Arma la clave en segundo plano si todavía no está (ni se está armando); lo de la remota sirve. */
    warm(key: string, load: () => Promise<T>) {
      if (slots.get(key)?.entry) return
      refresh(key, load, true)
    },
    /** Sólo tests. */
    keys: () => [...slots.keys()],
  }
}
