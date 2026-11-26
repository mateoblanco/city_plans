import { originFor } from "@/components/Tracking/utils/track";
import type { PlaceOrigin } from "@/lib/product-analytics/events";
import { track } from "@/lib/product-analytics/track";

/**
 * place_saved / place_unsaved: sólo el lugar tocado y de dónde (el de la card o, en la ficha, el de su vista). Nunca la
 * lista de guardados ni cuántos hay.
 */
export function trackSaveToggle(place: { id: string; slug: string }, nowSaved: boolean, origin: PlaceOrigin = originFor(place.id).origin) {
  track(nowSaved ? "place_saved" : "place_unsaved", { place_id: place.id, slug: place.slug, origin });
}
