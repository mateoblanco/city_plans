import type { Viewport } from "next";
import SearchPage from "@/components/pages/SearchPage/SearchPage";

// Mobile: el mapa y el panel llegan a los bordes; el header y el panel suman las zonas seguras de iOS (env(safe-area-inset-*)).
export const viewport: Viewport = { viewportFit: "cover" };

export default function Search({ searchParams }: PageProps<"/search">) {
  return <SearchPage searchParams={searchParams} />;
}
