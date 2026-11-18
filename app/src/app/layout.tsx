import type { Metadata, Viewport } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { allowIndexing, rootRobots, siteUrl } from "@/server/seo/indexing";
import { trackEvents } from "@/server/events/config";
import TrackingEnabled from "@/components/Tracking/TrackingEnabled/TrackingEnabled";
import '@/styles/reset.scss';
import '@/styles/global.scss';

// metadataBase: canonical y Open Graph con URL absoluta (SITE_URL). Sin ALLOW_INDEXING, noindex, nofollow en todo.
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: "Salimos",
  description: "Lugares para salir en Montevideo.",
  robots: rootRobots(allowIndexing()),
};

// Mobile: la página llega a los bordes y el header, el panel y los diálogos suman las zonas seguras de iOS
// (env(safe-area-inset-*), que sin viewport-fit=cover valen 0). themeColor: el blanco de --color-surface, el fondo del
// header (la app es sólo clara).
export const viewport: Viewport = { viewportFit: "cover", themeColor: "#ffffff" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="" />
        {/* Una familia por link: con varios f[] en la misma URL, Fontshare sólo devuelve la primera. */}
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=switzer@400,500,600&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=plein@500,600,700&display=swap"
        />
      </head>
      <body>
        {/* Cada página pone su <header> (banner) y su <main>: acá sólo el contenedor. */}
        <div className="root">
          {children}
        </div>
        {/* Web Vitals reales (LCP, INP, CLS) en el dashboard de Vercel. */}
        <SpeedInsights />
        {/* Popularidad: sólo con TRACK_EVENTS=true (Production) se carga el envío de eventos. */}
        {trackEvents() && <TrackingEnabled />}
      </body>
    </html>
  );
}
