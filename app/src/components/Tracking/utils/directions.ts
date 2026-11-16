import type { MouseEvent } from "react";
import { track } from "./track";

/**
 * "Cómo llegar" (el link "Google Maps" de la ficha): click normal (o Cmd/Ctrl, o Enter) y click del medio. Los handlers
 * no reciben el evento del click, así que nunca hacen preventDefault: el navegador abre el link como siempre.
 */
export function directionsHandlers(placeId: string, send: typeof track = track) {
  return {
    onClick: () => send(placeId, "directions"),
    onAuxClick: (event: Pick<MouseEvent, "button">) => {
      if (event.button === 1) send(placeId, "directions");
    },
  };
}
