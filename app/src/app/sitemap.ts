import type { MetadataRoute } from "next";
import { allowIndexing, siteUrl, sitemapEntries } from "@/server/seo/indexing";
import { sitemapPlaces } from "@/server/seo/sitemap-places";

// Sin ALLOW_INDEXING, un sitemap vacío (y sin consultar la base). Con él, la home y todas las fichas publicadas.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const allow = allowIndexing();
  const places = allow ? await sitemapPlaces().catch(() => []) : [];
  return sitemapEntries(allow, siteUrl(), places);
}
