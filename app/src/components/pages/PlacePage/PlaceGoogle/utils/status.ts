import type { OpenStateText } from "@/server/search/labels";

const isOpenTone = (tone: OpenStateText["tone"]) => tone === "open" || tone === "closing_soon";

/**
 * El estado de la ficha cuando llega Google. Sin estado de la base (horarios sin confirmar), el abierto/cerrado de Google
 * sin detalle. Con el de la base, se queda el de la base salvo que Google diga lo contrario (abierto contra cerrado):
 * ahí gana Google, sin detalle. Sin openNow de Google, el de la base.
 */
export function mergeStatus(base: OpenStateText | null, googleOpenNow: boolean | null): OpenStateText | null {
  if (googleOpenNow === null) return base;
  const google: OpenStateText = googleOpenNow
    ? { tone: "open", prefix: "", status: "Abierto", detail: null }
    : { tone: "closed", prefix: "", status: "Cerrado", detail: null };
  if (!base) return google;
  return isOpenTone(base.tone) === googleOpenNow ? base : google;
}
