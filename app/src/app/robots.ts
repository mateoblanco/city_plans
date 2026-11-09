import type { MetadataRoute } from "next";
import { allowIndexing, robotsConfig, siteUrl } from "@/server/seo/indexing";

// ALLOW_INDEXING (por defecto false): sin él, Disallow: / para todos. Ver server/seo/indexing.ts.
export default function robots(): MetadataRoute.Robots {
  return robotsConfig(allowIndexing(), siteUrl());
}
