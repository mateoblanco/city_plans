import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { MatchablePlace } from './match.ts'
import type { DiscountStore } from './persist.ts'
import { politeFetcher, rawDir, rawFetcher } from './polite-fetch.ts'
import { DISCOUNT_PROVIDERS } from './providers.ts'
import { DISCOUNT_READERS } from './readers.ts'
import { DEFAULT_DISCOUNTS_DIR, type RunDependencies } from './run.ts'
import { llmBenefitStructurer } from './structure-benefits.ts'

/**
 * Dependencias de una corrida con los proveedores configurados (o sólo `only`), guardando en `store`. `fromRun`:
 * reprocesa el HTML crudo de esa corrida, sin red; 'latest' toma la corrida más reciente de cada proveedor. El modelo
 * sólo se usa con AI_GATEWAY_API_KEY.
 */
export function discountRunDependencies(options: { store: DiscountStore; candidates: () => Promise<MatchablePlace[]>; root?: string; fromRun?: string; only?: string[] }): RunDependencies {
  const root = options.root ?? DEFAULT_DISCOUNTS_DIR
  return {
    providers: options.only ? DISCOUNT_PROVIDERS.filter((provider) => options.only!.includes(provider.id)) : DISCOUNT_PROVIDERS,
    readers: DISCOUNT_READERS,
    fetcherFor: async (runId, providerId) => {
      if (!options.fromRun) return politeFetcher({ dir: rawDir(root, runId, providerId) })
      const from = options.fromRun === 'latest' ? await latestRawRun(root, providerId) : options.fromRun
      if (!from) throw new Error(`No hay HTML crudo guardado de ${providerId} en ${join(root, 'raw')}.`)
      return rawFetcher(rawDir(root, from, providerId))
    },
    candidates: options.candidates,
    structure: process.env.AI_GATEWAY_API_KEY?.trim() ? llmBenefitStructurer({ cacheDir: join(root, 'llm') }) : undefined,
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
