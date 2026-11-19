import type { Metadata } from "next";
import GuidesCityPage from "@/components/pages/GuidesCityPage/GuidesCityPage";
import { cityPath, GUIDE_CITY } from "@/server/guides/catalog";

// Sólo el archivo de la ciudad: nada de la base ni de Google. La indexación es la del layout (ALLOW_INDEXING).
export const metadata: Metadata = {
  title: GUIDE_CITY.seoTitle,
  description: GUIDE_CITY.seoDescription,
  alternates: { canonical: cityPath(GUIDE_CITY.city) },
  openGraph: { type: "website", locale: "es_UY", siteName: "Salimos", url: cityPath(GUIDE_CITY.city), title: GUIDE_CITY.title, description: GUIDE_CITY.seoDescription },
  twitter: { card: "summary", title: GUIDE_CITY.title, description: GUIDE_CITY.seoDescription },
};

export default function GuidesCity() {
  return <GuidesCityPage />;
}
