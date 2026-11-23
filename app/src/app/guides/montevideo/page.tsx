import type { Metadata } from "next";
import GuidesCityPage from "@/components/pages/GuidesCityPage/GuidesCityPage";
import { getCityPage } from "@/server/guides/city-data";
import { SITE_NAME } from "@/lib/site";

// De la página de la ciudad (cacheada): título fijo, descripción de su introducción. Nada de Google. La indexación es
// la del layout (ALLOW_INDEXING).
export async function generateMetadata(): Promise<Metadata> {
  const data = await getCityPage();
  return {
    title: data.seoTitle,
    description: data.seoDescription,
    alternates: { canonical: data.path },
    openGraph: { type: "website", locale: "es_UY", siteName: SITE_NAME, url: data.path, title: data.title, description: data.seoDescription },
    twitter: { card: "summary", title: data.title, description: data.seoDescription },
  };
}

export default function GuidesCity() {
  return <GuidesCityPage />;
}
