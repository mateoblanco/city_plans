"use client";

import { useEffect } from "react";
import { enableTracking } from "../utils/track";

/**
 * Prende el envío de eventos (guardar, "Google Maps"). El layout lo renderiza sólo con TRACK_EVENTS=true; el código que
 * envía (send.ts) se baja recién acá, con import(): apagado, nunca llega al navegador.
 */
const TrackingEnabled = () => {
  useEffect(() => enableTracking(), []);
  return null;
};

export default TrackingEnabled;
