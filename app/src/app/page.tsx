import type { Metadata } from "next";
import HomePage from "@/components/pages/HomePage/HomePage";
import { SITE_NAME } from "@/lib/site";
import { shareDescription } from "@/lib/description";

const TITLE = `${SITE_NAME} · Lugares para salir en Montevideo`;
const DESCRIPTION = "Bares, cafés y restaurantes de Montevideo para salir hoy: buscá por plan, barrio, dieta o descuento.";
const SHARE_DESCRIPTION = shareDescription(DESCRIPTION);
// La imagen es la de la raíz (app/opengraph-image.jpg).

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: { type: "website", locale: "es_UY", siteName: SITE_NAME, url: "/", title: TITLE, description: SHARE_DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: SHARE_DESCRIPTION },
};

export default function Home({ searchParams }: PageProps<"/">) {
  return <HomePage searchParams={searchParams} />;
}
