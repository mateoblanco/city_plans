import type { PageType } from "./events";

/** El tipo de página de un pathname (sin query). */
export function pageType(pathname: string): PageType {
  if (pathname === "/") return "home";
  if (pathname === "/search") return "search";
  if (pathname.startsWith("/place/")) return "place";
  // La ciudad (índice de guías); /guides redirige ahí.
  if (pathname === "/guides" || pathname === "/guides/montevideo") return "guides_city";
  // Una guía (o la página de un barrio, que comparte la ruta: el pathname no las distingue).
  if (pathname.startsWith("/guides/")) return "guide";
  if (pathname === "/privacy" || pathname === "/terms") return "legal";
  return "other";
}
