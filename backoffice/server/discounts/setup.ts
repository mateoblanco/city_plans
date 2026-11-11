import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { MatchablePlace } from './match.ts'
import type { DiscountStore } from './persist.ts'
import { politeFetcher, rawDir, rawFetcher } from './polite-fetch.ts'
import { discountProviders } from './providers.ts'
import { ideUyGeocoder } from './geocode.ts'
import { brouRowSplitter, llmRowSplitter } from './brou/split-rows.ts'
import { DISCOUNT_READERS } from './readers.ts'
import { DEFAULT_DISCOUNTS_DIR, type RunDependencies } from './run.ts'
import { llmBenefitStructurer } from './structure-benefits.ts'

/**
 * Dependencias de una corrida con los proveedores configurados (o sólo `only`), guardando en `store`. `fromRun`:
 * reprocesa el HTML crudo de esa corrida, sin red (el geocodificador, sólo del cache); 'latest' toma la corrida más
 * reciente de cada proveedor. El modelo sólo se usa con AI_GATEWAY_API_KEY. Las fuentes se leen de
 * config/discount-sources.json en cada corrida.
 */
export function discountRunDependencies(options: { store: DiscountStore; candidates: () => Promise<MatchablePlace[]>; root?: string; fromRun?: string; only?: string[] }): RunDependencies {
  const root = options.root ?? DEFAULT_DISCOUNTS_DIR
  const model = Boolean(process.env.AI_GATEWAY_API_KEY?.trim())
  const configured = () => discountProviders()
  return {
    // Getters: el servidor arma estas dependencias una vez, y cada corrida (DiscountRunner.start las copia) toma el
    // config de fuentes de ese momento y un geocodificador nuevo (con su cuenta de pedidos).
    get providers() {
      const providers = configured()
      return options.only ? providers.filter((provider) => options.only!.includes(provider.id)) : providers
    },
    readers: DISCOUNT_READERS,
    fetcherFor: async (runId, providerId) => {
      if (!options.fromRun) return politeFetcher({ dir: rawDir(root, runId, providerId) })
      const from = options.fromRun === 'latest' ? await latestRawRun(root, providerId) : options.fromRun
      if (!from) throw new Error(`No hay HTML crudo guardado de ${providerId} en ${join(root, 'raw')}.`)
      // Primero lo del proveedor; si le falta una página (otro proveedor la comparte), la de los demás de esa corrida.
      const others = configured().filter((provider) => provider.id !== providerId).map((provider) => rawDir(root, from, provider.id))
      return rawFetcher([rawDir(root, from, providerId), ...others])
    },
    candidates: options.candidates,
    structure: model ? llmBenefitStructurer({ cacheDir: join(root, 'llm') }) : undefined,
    // Por las celdas del PDF; el modelo sólo para un departamento que no se pueda separar así.
    splitRows: brouRowSplitter({ fallback: model ? llmRowSplitter({ cacheDir: join(root, 'llm') }) : undefined }),
    get geocoder() {
      return ideUyGeocoder({ cacheDir: join(root, 'geocode'), offline: Boolean(options.fromRun) })
    },
    store: options.store,
  }
}

/**
 * La corrida más reciente con HTML crudo guardado (cache/discounts/raw/<id>), o la más reciente que tenga el de ese
 * proveedor (cada uno puede venir de una corrida distinta), para reprocesar sin red.
 */
export async function latestRawRun(root = DEFAULT_DISCOUNTS_DIR, providerId?: string): Promise<string | null> {
  const runs = (await readdir(join(root, 'raw')).catch(() => [] as string[])).filter((name) => /^\d{8}T\d{6}Z$/.test(name)).sort().reverse()
  if (!providerId) return runs[0] ?? null
  for (const run of runs) {
    const index = await stat(join(root, 'raw', run, providerId, 'index.json')).catch(() => null)
    if (index) return run
  }
  return null
}
