import { NextResponse, type NextRequest } from "next/server";
import { GUIDES_HOME_TARGET, guideProxyAction, guideRoutes } from "@/server/guides/routes";

// Una vez por instancia: las rutas de las guías salen del archivo y sólo cambian con un deploy. Sin base de datos.
const GUIDE_ROUTES = guideRoutes();

/**
 * /guides/*: /guides redirige (307) a /guides/montevideo; lo que existe (ciudad, barrios con guías, guías) sigue de
 * largo; lo demás (un barrio sin guías, un slug inexistente, un borrador en producción) es un 404 real. Sin esto, con
 * cacheComponents el shell sale con 200 antes del notFound() de la página (soft 404, como en la ficha).
 */
export function proxy(request: NextRequest) {
  const action = guideProxyAction(request.nextUrl.pathname, GUIDE_ROUTES);
  if (action === "next") return NextResponse.next();
  if (action === "redirect") return NextResponse.redirect(new URL(GUIDES_HOME_TARGET, request.url), 307);
  return NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
}

// Sólo /guides y lo de abajo: el resto de la app no pasa por el proxy.
export const config = {
  matcher: "/guides/:path*",
};
