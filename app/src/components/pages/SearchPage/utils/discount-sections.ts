import { discountSectionProvider, isDiscountSectionId } from "@/lib/discount-section-ids";
import { setDiscountsHref, type SearchUrl } from "./search-href";

/**
 * "Ver todos" de un grupo por proveedor de descuento (`discount:itau`): la misma búsqueda con sólo las elecciones de ese
 * proveedor (así ya no se agrupa). null si no es un grupo de descuento.
 */
export function discountViewAllHref(state: SearchUrl, sectionId: string): string | null {
  if (!isDiscountSectionId(sectionId)) return null;
  const prefix = `discount:${discountSectionProvider(sectionId)}.`;
  const own = (state.f ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.startsWith(prefix))
    .map((item) => item.slice("discount:".length));
  return setDiscountsHref(state, own);
}
