import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { CARD_TYPES, DISCOUNT_PROVIDERS as CATALOG, type CardType, type DiscountProviderInfo } from '../../src/types/discounts.ts'

export { type DiscountProviderId } from '../../src/types/discounts.ts'

/** Una página fuente de un proveedor (config/discount-sources.json). */
export type DiscountProviderPage = {
  url: string
  label: string
  /**
   * Las tarjetas que esta página le da a este proveedor: pisan el tipo y los niveles que dice el texto (el porcentaje,
   * los días, la modalidad y las bases siguen saliendo de la página). Personal Bank: la misma página da débito y crédito
   * del paquete a Itaú Personal Bank y crédito Visa Infinite y Mastercard Black a Itaú.
   */
  cards?: { cardType: CardType; cardTiers: string[] }[]
  /**
   * Los lugares de esta página heredan el cruce manual (vinculado, confirmado o ignorado) del mismo logo en este otro
   * proveedor, si el suyo es nuevo o automático.
   */
  manualMatchFrom?: string
}

/** Un proveedor del catálogo con sus fuentes. */
export type DiscountProvider = DiscountProviderInfo & {
  /** Página de la que sale el listado. */
  sourceUrl: string
  /** Parámetros del listado (filtros) y tope de páginas de seguridad, si el lector pagina. */
  listing?: { params: Record<string, string>; maxPages: number }
  /** Varias páginas fuente (Itaú: Restaurantes, Platinum y Personal Bank; BROU: una por campaña). Sin esto, la única es sourceUrl. */
  pages?: DiscountProviderPage[]
}

/** Editable sin tocar código (más adelante, desde la pantalla). */
export const DISCOUNT_SOURCES_FILE = join(import.meta.dirname, '../../config/discount-sources.json')

const providerIds = CATALOG.map((provider) => provider.id) as [string, ...string[]]
const httpsUrl = z.string().url().refine((value) => value.startsWith('https://'), 'tiene que ser https')
const Source = z.object({
  nota: z.string().optional(),
  sourceUrl: httpsUrl,
  listing: z.object({ params: z.record(z.string(), z.string()), maxPages: z.number().int().min(1).max(200) }).strict().optional(),
  pages: z.array(z.object({
    url: httpsUrl,
    label: z.string().trim().min(1),
    cards: z.array(z.object({ cardType: z.enum(CARD_TYPES), cardTiers: z.array(z.string().trim().min(1)) }).strict()).optional(),
    manualMatchFrom: z.enum(providerIds).optional(),
  }).strict()).min(1).optional(),
}).strict()
const SourcesFile = z.object({ $comment: z.string().optional(), providers: z.record(z.string(), Source) }).strict()

/**
 * Junta el catálogo con las fuentes y lo valida: cada proveedor del catálogo tiene que tener su fuente, y no puede haber
 * fuentes de proveedores que no están en el catálogo.
 */
export function parseDiscountSources(raw: unknown): DiscountProvider[] {
  const parsed = SourcesFile.safeParse(raw)
  if (!parsed.success) throw new Error(`config/discount-sources.json no es válido: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`)
  const sources = parsed.data.providers
  const unknown = Object.keys(sources).filter((id) => !providerIds.includes(id))
  if (unknown.length) throw new Error(`config/discount-sources.json tiene proveedores que no están en el catálogo: ${unknown.join(', ')}.`)
  const missing = providerIds.filter((id) => !sources[id])
  if (missing.length) throw new Error(`config/discount-sources.json no tiene fuente para: ${missing.join(', ')}.`)
  return CATALOG.map((provider) => {
    const { nota: _nota, ...source } = sources[provider.id]
    return { ...provider, ...source }
  })
}

/** Los proveedores con sus fuentes. Se lee el archivo en cada llamada: una URL nueva vale desde la próxima corrida. */
export function discountProviders(file = DISCOUNT_SOURCES_FILE): DiscountProvider[] {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`No se pudo leer ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return parseDiscountSources(raw)
}

export function discountProvider(id: string): DiscountProvider | undefined {
  return discountProviders().find((provider) => provider.id === id)
}

/** Ids del catálogo (sin leer el archivo de fuentes). */
export const DISCOUNT_PROVIDER_IDS: readonly string[] = providerIds
