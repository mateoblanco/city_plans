import type { MetadataRoute } from "next";
import { allowIndexing, robotsConfig } from "@/server/seo/indexing";
import { SITE_URL } from "@/lib/site";

// ALLOW_INDEXING (por defecto false; sólo vale con VERCEL_ENV=production): sin él, Disallow: / para todos. Ver
// server/seo/indexing.ts.
export default function robots(): MetadataRoute.Robots {
  return robotsConfig(allowIndexing(), SITE_URL);
}
