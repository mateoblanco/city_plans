"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { analyticsUrl } from "@/lib/analytics-url";

/**
 * Vercel Web Analytics (visitas y páginas vistas) y Speed Insights (Web Vitals reales), en el layout. Cliente porque
 * beforeSend es una función: antes de enviar, saca de la URL el texto de búsqueda y los otros parámetros de
 * ANALYTICS_STRIPPED_PARAMS (src/lib/analytics-url.ts). En local no envían.
 */
const WebAnalytics = () => (
  <>
    <Analytics beforeSend={(event) => ({ ...event, url: analyticsUrl(event.url) })} />
    <SpeedInsights beforeSend={(event) => ({ ...event, url: analyticsUrl(event.url) })} />
  </>
);

export default WebAnalytics;
