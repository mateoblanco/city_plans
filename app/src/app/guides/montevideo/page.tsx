import type { Metadata } from "next";
import GuidesCityPage from "@/components/pages/GuidesCityPage/GuidesCityPage";
import { getCityPage } from "@/server/guides/city-data";
import { DEFAULT_OG_IMAGE, SITE_NAME } from "@/lib/site";
import { shareDescription } from "@/lib/description";

// De la página de la ciudad (cacheada): título fijo, descripción de su introducción. Nada de Google. La indexación es
// la del layout (ALLOW_INDEXING).
export async function generateMetadata(): Promise<Metadata> {
  const data = await getCityPage();
  const share = shareDescription(data.seoDescription);
  return {
    title: data.seoTitle,
    description: data.seoDescription,
    alternates: { canonical: data.path },
    openGraph: { type: "website", locale: "es_UY", siteName: SITE_NAME, url: data.path, title: data.title, description: share, images: [DEFAULT_OG_IMAGE] },
    twitter: { card: "summary_large_image", title: data.title, description: share, images: [DEFAULT_OG_IMAGE] },
  };
}

export default function GuidesCity() {
  return <GuidesCityPage />;
}
