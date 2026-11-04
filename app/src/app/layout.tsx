import type { Metadata } from "next";
import '@/styles/reset.scss';
import '@/styles/global.scss';

export const metadata: Metadata = {
  title: "Salimos",
  description: "Lugares para salir en Montevideo.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="" />
        {/* Una familia por link: con varios f[] en la misma URL, Fontshare sólo devuelve la primera. */}
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=switzer@400&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=plein@700&display=swap"
        />
      </head>
      <body>
        <main className="root">
          {children}
        </main>
      </body>
    </html>
  );
}
