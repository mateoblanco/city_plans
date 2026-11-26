import type { PageType } from "./events";

/** El tipo de página de un pathname (sin query). */
export function pageType(pathname: string): PageType {
  if (pathname === "/") return "home";
  if (pathname === "/search") return "search";
  if (pathname.startsWith("/place/")) return "place";
  if (pathname === "/guides" || pathname.startsWith("/guides/")) return "guide";
  if (pathname === "/privacy" || pathname === "/terms") return "legal";
  return "other";
}
