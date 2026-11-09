import type { Metadata, Viewport } from "next";
import SearchPage from "@/components/pages/SearchPage/SearchPage";
import { readParams, toSearchOptions } from "@/components/pages/SearchPage/utils/search-params";
import { searchTitle, searchTitleInput } from "@/components/pages/SearchPage/utils/search-title";
import { searchPlaces } from "@/server/search";
import { allowIndexing, searchRobots } from "@/server/seo/indexing";

// Mobile: el mapa y el panel llegan a los bordes; el header y el panel suman las zonas seguras de iOS (env(safe-area-inset-*)).
export const viewport: Viewport = { viewportFit: "cover" };

// El título sale de la misma búsqueda que la página (searchPlaces está deduplicada por request): no hay otra llamada.
// /search nunca se indexa (searchRobots).
export async function generateMetadata({ searchParams }: PageProps<"/search">): Promise<Metadata> {
  const params = await readParams(searchParams);
  const response = await searchPlaces(params.query, toSearchOptions(params)).catch(() => null);
  return {
    title: searchTitle(searchTitleInput(params.query, response)),
    robots: searchRobots(allowIndexing()),
  };
}

export default function Search({ searchParams }: PageProps<"/search">) {
  return <SearchPage searchParams={searchParams} />;
}
