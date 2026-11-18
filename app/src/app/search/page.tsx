import type { Metadata } from "next";
import SearchPage from "@/components/pages/SearchPage/SearchPage";
import { readParams, toSearchOptions } from "@/components/pages/SearchPage/utils/search-params";
import { searchTitle, searchTitleInput } from "@/components/pages/SearchPage/utils/search-title";
import { searchPlaces } from "@/server/search";
import { allowIndexing, searchRobots } from "@/server/seo/indexing";

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
