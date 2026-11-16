"use client";

import { useEffect } from "react";
import { trackView } from "../utils/track";
import { whenVisible } from "../utils/view";

type Props = {
  placeId: string;
  slug: string;
};

/**
 * "Ficha vista": se cuenta en el navegador, en un efecto, cuando la ficha se muestra de verdad (visible). Nunca en el
 * render del servidor (los efectos no corren ahí) ni en el prefetch de Next (baja el payload, no monta componentes).
 * La ficha lo renderiza sólo con TRACK_EVENTS=true. La base deja una por persona y día.
 */
const PlaceViewBeacon = (props: Props) => {
  useEffect(() => whenVisible(document, () => trackView(props.placeId, props.slug)), [props.placeId, props.slug]);
  return null;
};

export default PlaceViewBeacon;
