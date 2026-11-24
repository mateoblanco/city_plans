import type { Metadata } from "next";
import LegalPage from "@/components/pages/LegalPage/LegalPage";
import { LEGAL_PAGES } from "@/lib/legal";
import { shareDescription } from "@/lib/description";
import { DEFAULT_OG_IMAGE, SITE_NAME, withSiteName } from "@/lib/site";

const page = LEGAL_PAGES.privacy;
const description = `Qué datos usa ${SITE_NAME}, para qué, con quién se comparten y cómo ejercer tus derechos. Sin cuentas: casi todo queda en tu navegador.`;

const share = shareDescription(description);

// Indexable como el resto (la indexación es la del layout, ALLOW_INDEXING) y en el sitemap.
export const metadata: Metadata = {
  title: withSiteName(page.title),
  description,
  alternates: { canonical: page.path },
  openGraph: { type: "website", locale: "es_UY", siteName: SITE_NAME, url: page.path, title: page.title, description: share, images: [DEFAULT_OG_IMAGE] },
  twitter: { card: "summary_large_image", title: page.title, description: share, images: [DEFAULT_OG_IMAGE] },
};

export default function Page() {
  return <LegalPage page="privacy" />;
}
