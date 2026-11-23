import type { MetadataRoute } from "next";
import { allowIndexing, sitemapEntries } from "@/server/seo/indexing";
import { sitemapPlaces } from "@/server/seo/sitemap-places";
import { guideSitemapPages } from "@/server/guides/sitemap";
import { publishedGuides } from "@/server/guides/published";
import { SITE_URL } from "@/lib/site";

// Sin ALLOW_INDEXING (o fuera de Production), un sitemap vacío y sin consultar la base. Con él, la home, las páginas de
// guías (de la base: ciudad, barrios activos y guías publicadas con lugares publicados, sin borradores) y todas las fichas
// publicadas, cada una con su última modificación en la base.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const allow = allowIndexing();
  const [places, guides] = allow
    ? await Promise.all([sitemapPlaces().catch(() => []), publishedGuides().then(guideSitemapPages).catch(() => [])])
    : [[], []];
  return sitemapEntries(allow, SITE_URL, places, guides);
}
