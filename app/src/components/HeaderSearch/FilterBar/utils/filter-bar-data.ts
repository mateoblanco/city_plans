import { publishedNeighborhoods } from "@/server/search";
import { activeDiscountProviders, type DiscountProviderOption } from "@/server/discounts";

/** Lo que la barra lee de la base: los barrios con lugares publicados y los proveedores de descuento que cuentan. */
export type FilterBarData = {
  publishedNeighborhoods: string[];
  discountProviders: DiscountProviderOption[];
};

/**
 * Las dos consultas a la vez. Quien renderiza la barra las arranca junto con la búsqueda (SearchFilters), así no
 * esperan a que termine. Si una falla, esa parte va vacía, como antes.
 */
export async function loadFilterBarData(): Promise<FilterBarData> {
  const [neighborhoods, discountProviders] = await Promise.all([
    publishedNeighborhoods().catch(() => [] as string[]),
    activeDiscountProviders().catch(() => [] as DiscountProviderOption[]),
  ]);
  return { publishedNeighborhoods: neighborhoods, discountProviders };
}
