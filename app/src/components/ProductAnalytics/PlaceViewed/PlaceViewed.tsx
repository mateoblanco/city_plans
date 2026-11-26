"use client";

import { useEffect } from "react";
import { viewOrigin } from "@/components/Tracking/utils/track";
import { whenVisible } from "@/components/Tracking/utils/view";
import { track } from "@/lib/product-analytics/track";

type Props = {
  placeId: string;
  slug: string;
};

/**
 * place_viewed (analítica de producto), con el origen de la popularidad (de dónde vino el click a la ficha). Como
 * PlaceViewBeacon: en un efecto y con la ficha visible, nunca en el render del servidor ni en el prefetch. Va después
 * de PlaceViewBeacon, así toma el mismo origen.
 */
const PlaceViewed = (props: Props) => {
  useEffect(
    () =>
      whenVisible(document, () => {
        const origin = viewOrigin(props.placeId, props.slug);
        track("place_viewed", { place_id: props.placeId, slug: props.slug, origin: origin.origin, row: origin.row });
      }),
    [props.placeId, props.slug],
  );
  return null;
};

export default PlaceViewed;
