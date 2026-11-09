import { DISCOUNTS_CONFIG } from './config'
import { matchesChoice, providerName, selectedProviders, type DiscountChoice, type PlaceDiscount } from './selection'
import type { DiscountSectionId } from '@/lib/discount-section-ids'

// Los ids de grupo viven en src/lib (también los usa el cliente, utils/discount-sections.ts); se reexportan acá.
export { discountSectionProvider, isDiscountSectionId, type DiscountSectionId } from '@/lib/discount-section-ids'

export type DiscountSection = { id: DiscountSectionId; title: string; placeIds: string[]; total: number }

/**
 * Con 2 o más proveedores elegidos, los resultados se agrupan por proveedor ("Con descuento Itaú"), en el orden de la
 * config: en cada grupo, los que cumplen las elecciones de ese proveedor en orden de ranking, hasta groupMax (total
 * dice cuántos cumplen, para "Ver todos"). Un lugar con varios va en cada grupo. Con menos de 2 proveedores, null: los
 * grupos de siempre.
 */
export function discountSections(items: { id: string; discounts: PlaceDiscount[] }[], choices: DiscountChoice[]): DiscountSection[] | null {
  const providers = selectedProviders(choices)
  if (providers.length < 2) return null
  const sections = providers.flatMap((provider): DiscountSection[] => {
    const own = choices.filter((choice) => choice.provider === provider)
    const ids = items.filter((item) => item.discounts.some((discount) => own.some((choice) => matchesChoice(discount, choice)))).map((item) => item.id)
    return ids.length ? [{ id: `discount:${provider}`, title: DISCOUNTS_CONFIG.groupTitle(providerName(provider)), placeIds: ids.slice(0, DISCOUNTS_CONFIG.groupMax), total: ids.length }] : []
  })
  return sections.length ? sections : null
}
