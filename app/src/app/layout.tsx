import type { Metadata } from "next";
import { Baskervville, Geist } from "next/font/google";
import '@/styles/reset.scss';
import '@/styles/global.scss';

const baskervville = Baskervville({
  variable: "--font-baskervville",
  subsets: ["latin"],
});

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Salimos",
  description: "Lugares para salir en Montevideo.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${baskervville.variable} ${geist.variable}`}>
      <body>
        <main className="root">
          {children}
        </main>
      </body>
    </html>
  );
}
