"use client";

import type { OpenStateText } from "@/server/search/labels";
import { usePlaceGoogle } from "../../PlaceGoogle/utils/context";
import { mergeStatus } from "../../PlaceGoogle/utils/status";
import PlaceStatus from "../PlaceStatus/PlaceStatus";

type Props = {
  /** El estado de los horarios de la base (placeOpenText sin Google); null si la base no lo sabe. */
  base: OpenStateText | null;
};

/**
 * El estado de un lugar en Google: el de la base mientras llega (o vacío, con la línea ya reservada) y, cuando llega,
 * el de mergeStatus. La línea tiene alto fijo: cambiar el texto no mueve nada.
 */
const GoogleStatus = (props: Props) => {
  const google = usePlaceGoogle();
  const status = google.status === "ready" ? mergeStatus(props.base, google.info.openNow) : props.base;
  return <PlaceStatus status={status} />;
};

export default GoogleStatus;
