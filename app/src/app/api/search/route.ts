import type { NextRequest } from "next/server";
import { z } from "zod";
import { searchPlaces } from "@/server/search";
import { LOCATION_COOKIE } from "@/lib/location";
import { parseSavedCookie, SAVED_COOKIE } from "@/components/pages/SearchPage/utils/saved-cookie";

const Params = z.object({
  q: z.string().trim().max(500),
  remove: z.string().max(500).nullish(),
  f: z.string().max(500).nullish(),
  loc: z.string().max(80).nullish(),
  near: z.string().max(50).nullish(),
  intent: z.string().max(50).nullish(),
  sub: z.string().max(500).nullish(),
  debug: z.enum(["1", "true"]).nullish(),
  profile: z.enum(["on", "off"]).nullish(),
});

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const parsed = Params.safeParse({
    q: searchParams.get("q") ?? "",
    remove: searchParams.get("remove"),
    f: searchParams.get("f"),
    loc: searchParams.get("loc"),
    near: searchParams.get("near"),
    intent: searchParams.get("intent"),
    sub: searchParams.get("sub"),
    debug: searchParams.get("debug"),
    profile: searchParams.get("profile"),
  });
  // Sin q ni filtros también es válido: trae todos los publicados, por calidad (como /search vacío).
  if (!parsed.success) {
    return Response.json({ error: "Algún parámetro es demasiado largo o no es válido." }, { status: 400 });
  }

  try {
    const { q, remove, f, loc, near, intent, sub, debug, profile } = parsed.data;
    // Guardados de la cookie espejo de localStorage (la señal de gustos del perfil): sólo para este pedido.
    const likes = parseSavedCookie(request.cookies.get(SAVED_COOKIE)?.value);
    // Ubicación de la cookie `loc` (redondeada a ~100 m): sólo para este pedido. Sin `loc` ni barrio, cerca mío como /search.
    const userLocation = request.cookies.get(LOCATION_COOKIE)?.value ?? null;
    return Response.json(
      await searchPlaces(q, { remove, filters: f, loc, near, userLocation, defaultNear: true, intent, sub, debug: Boolean(debug), likes, profile: profile !== "off" }),
    );
  } catch (error) {
    console.error("Error en /api/search", error);
    return Response.json({ error: "No pudimos completar la búsqueda." }, { status: 500 });
  }
}
