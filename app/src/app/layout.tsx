import type { Metadata, Viewport } from "next";
import { Merriweather } from "next/font/google";
import { allowIndexing, rootRobots } from "@/server/seo/indexing";
import { trackEvents } from "@/server/events/config";
import TrackingEnabled from "@/components/Tracking/TrackingEnabled/TrackingEnabled";
import WebAnalytics from "@/components/WebAnalytics/WebAnalytics";
import ProductAnalytics from "@/components/ProductAnalytics/ProductAnalytics";
import { productAnalytics } from "@/server/product-analytics/config";
import '@/styles/reset.scss';
import '@/styles/global.scss';
import { SITE_NAME, SITE_URL } from "@/lib/site";

// metadataBase: canonical y Open Graph con URL absoluta (SITE_URL, el dominio principal). Sin ALLOW_INDEXING (o fuera de
// Production), noindex, nofollow en todo. Open Graph base (locale y nombre del sitio) para las páginas que no lo definen.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_NAME,
  description: "Lugares para salir a comer o tomar algo en Uruguay.",
  openGraph: { type: "website", locale: "es_UY", siteName: SITE_NAME },
  twitter: { card: "summary_large_image" },
  robots: rootRobots(allowIndexing()),
};

// Mobile: la página llega a los bordes y el header, el panel y los diálogos suman las zonas seguras de iOS
// (env(safe-area-inset-*), que sin viewport-fit=cover valen 0). themeColor: el blanco de --color-surface, el fondo del
// header (la app es sólo clara).
// Títulos (--font-display en _tokens.scss). OFL: next/font la baja en el build y la sirve desde el sitio. Variable sin ejes
// extra (opsz duplica el peso): un solo .woff2 latin cubre 500/600/700, con preload en todas las rutas.
const merriweather = Merriweather({ subsets: ["latin"], display: "swap", variable: "--font-merriweather" });

export const viewport: Viewport = { viewportFit: "cover", themeColor: "#ffffff" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  const analytics = productAnalytics();
  return (
    <html lang="es-UY" className={merriweather.variable}>
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=switzer@400,500,600&display=swap"
        />
      </head>
      <body>
        {/* Cada página pone su <header> (banner) y su <main>: acá sólo el contenedor. */}
        <div className="root">
          {children}
        </div>
        {/* Visitas, páginas vistas y Web Vitals en el dashboard de Vercel, sin el texto de búsqueda en la URL. En local no envía. */}
        <WebAnalytics />
        {/* Popularidad: sólo con TRACK_EVENTS=true (Production) se carga el envío de eventos. */}
        {trackEvents() && <TrackingEnabled />}
        {/* Uso del sitio en Mixpanel: sólo en Production con MIXPANEL_TOKEN (o MIXPANEL_DEBUG en local, que no envía). */}
        {analytics.mode !== "off" && (
          <ProductAnalytics mode={analytics.mode} token={analytics.token} />
        )}
      </body>
    </html>
  );
}
