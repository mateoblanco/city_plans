import { getCache } from "@vercel/functions";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { getSql } from "@/server/db";
import { readGuides } from "@/server/guides/db";
import { PREVIEW_PARAM } from "@/server/guides/preview";
import { GUIDES_HOME_TARGET, guideProxyAction, guideRoutes } from "@/server/guides/routes";
import { createGuideRoutesCache } from "@/server/guides/routes-cache";
import { createPlaceSlugsCache, placeProxyAction } from "@/server/places/slugs-cache";

// Las rutas que existen salen de la base, pero no en cada pedido: una lista cacheada por instancia (y en la Runtime
// Cache de Vercel) que se rearma a la hora, como las páginas (server/guides/routes-cache.ts).
const routesCache = createGuideRoutesCache({
  load: async () => guideRoutes(await readGuides((text, params) => getSql().query(text, params) as Promise<unknown[]>)),
  remote: process.env.VERCEL ? getCache({ keyHashFunction: (key) => key }) : null,
  onError: (error) => console.error("Falló la lista de rutas de las guías", error),
});

// Lo mismo para las fichas: los slugs publicados, cacheados un minuto (server/places/slugs-cache.ts).
const slugsCache = createPlaceSlugsCache({
  load: async () => {
    const rows = (await getSql().query("select slug from places where status = 'published'", [])) as { slug: string }[];
    return rows.map((row) => row.slug);
  },
  remote: process.env.VERCEL ? getCache({ keyHashFunction: (key) => key }) : null,
  onError: (error) => console.error("Falló la lista de slugs de las fichas", error),
});

const notFound = (request: NextRequest) => NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });

/**
 * /place/<slug>: 404 real si el slug no es de una ficha publicada (con cacheComponents, el shell de la ficha sale con 200
 * antes del notFound() de la página). Sin lista (la base falló), deja pasar: queda el notFound() de la página.
 */
async function placeProxy(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;
  // Un slug inválido no necesita la lista.
  if (placeProxyAction(pathname, null) === "notFound") return notFound(request);
  const { slugs, background } = await slugsCache.slugs();
  if (background) event.waitUntil(background);
  return placeProxyAction(pathname, slugs) === "notFound" ? notFound(request) : NextResponse.next();
}

/**
 * /guides/*: /guides redirige (307) a /guides/montevideo; con ?preview=<clave> una guía (también borrador) se reescribe
 * a la vista previa; lo que existe (ciudad, barrios con guías, guías con lugares publicados) sigue de largo; lo demás
 * (un barrio sin guías, un slug inexistente, un borrador sin la clave) es un 404 real. Sin esto, con cacheComponents el
 * shell sale con 200 antes del notFound() de la página (soft 404, como en la ficha). /guide-preview/* directo, 404.
 */
export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const { pathname, searchParams } = request.nextUrl;
  if (pathname.startsWith("/place/")) return placeProxy(request, event);
  const preview = searchParams.get(PREVIEW_PARAM);
  // La vista previa y el redirect no necesitan la lista.
  const quick = guideProxyAction(pathname, null, { preview });
  if (quick.kind === "redirect") return NextResponse.redirect(new URL(GUIDES_HOME_TARGET, request.url), 307);
  if (quick.kind === "preview") return NextResponse.rewrite(new URL(`${quick.path}${request.nextUrl.search}`, request.url));
  if (quick.kind === "notFound") return notFound(request);

  const { routes, background } = await routesCache.routes();
  if (background) event.waitUntil(background);
  const action = guideProxyAction(pathname, routes);
  if (action.kind === "notFound") return notFound(request);
  return NextResponse.next();
}

// Sólo /guides (y lo de abajo), la ruta interna de la vista previa y las fichas: el resto de la app no pasa por el proxy.
export const config = {
  matcher: ["/guides/:path*", "/guide-preview/:path*", "/place/:slug"],
};
