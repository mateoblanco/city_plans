import type { MetadataRoute } from "next";
import { allowIndexing, siteUrl, sitemapEntries } from "@/server/seo/indexing";
import { sitemapPlaces } from "@/server/seo/sitemap-places";
import { guideSitemapPages } from "@/server/guides/sitemap";

// Sin ALLOW_INDEXING, un sitemap vacío (y sin consultar la base). Con él, la home, las páginas de guías (del archivo:
// barrios y guías, sin borradores) y todas las fichas publicadas.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const allow = allowIndexing();
  const places = allow ? await sitemapPlaces().catch(() => []) : [];
  const guides = guideSitemapPages();
  return sitemapEntries(allow, siteUrl(), places, guides);
}
