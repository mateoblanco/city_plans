import type { Metadata } from "next";
import HomePage from "@/components/pages/HomePage/HomePage";

const TITLE = "Salimos · Lugares para salir en Montevideo";
const DESCRIPTION = "Bares, cafés y restaurantes de Montevideo para salir hoy: buscá por plan, barrio, dieta o descuento.";
// Imagen genérica (recorte 1200×630 del hero).
const IMAGE = { url: "/og-home.jpg", width: 1200, height: 630, alt: "Ilustración de la Plaza Independencia de Montevideo" };

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: { type: "website", locale: "es_UY", siteName: "Salimos", url: "/", title: TITLE, description: DESCRIPTION, images: [IMAGE] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [IMAGE.url] },
};

export default function Home() {
  return (
      <HomePage />
  );
}
