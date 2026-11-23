import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { allowIndexing, rootRobots } from "@/server/seo/indexing";
import { trackEvents } from "@/server/events/config";
import TrackingEnabled from "@/components/Tracking/TrackingEnabled/TrackingEnabled";
import '@/styles/reset.scss';
import '@/styles/global.scss';
import { SITE_NAME, SITE_URL } from "@/lib/site";

// metadataBase: canonical y Open Graph con URL absoluta (SITE_URL, el dominio principal). Sin ALLOW_INDEXING (o fuera de
// Production), noindex, nofollow en todo. Open Graph base (locale y nombre del sitio) para las páginas que no lo definen.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_NAME,
  description: "Lugares para salir en Montevideo.",
  openGraph: { type: "website", locale: "es_UY", siteName: SITE_NAME },
  twitter: { card: "summary_large_image" },
  robots: rootRobots(allowIndexing()),
};

// Mobile: la página llega a los bordes y el header, el panel y los diálogos suman las zonas seguras de iOS
// (env(safe-area-inset-*), que sin viewport-fit=cover valen 0). themeColor: el blanco de --color-surface, el fondo del
// header (la app es sólo clara).
export const viewport: Viewport = { viewportFit: "cover", themeColor: "#ffffff" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-UY">
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
        {/* Visitas y páginas vistas en el dashboard de Vercel. En local no envía. */}
        <Analytics />
        {/* Web Vitals reales (LCP, INP, CLS) en el dashboard de Vercel. */}
        <SpeedInsights />
        {/* Popularidad: sólo con TRACK_EVENTS=true (Production) se carga el envío de eventos. */}
        {trackEvents() && <TrackingEnabled />}
      </body>
    </html>
  );
}
