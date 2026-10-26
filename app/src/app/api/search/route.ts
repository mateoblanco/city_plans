import type { NextRequest } from "next/server";
import { z } from "zod";
import { searchPlaces } from "@/server/search";
import { LIKES_COOKIE, parseLikesCookie } from "@/components/pages/SearchPage/utils/likes-cookie";

const Params = z.object({
  q: z.string().trim().max(500),
  remove: z.string().max(500).nullish(),
  f: z.string().max(500).nullish(),
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
    const { q, remove, f, near, intent, sub, debug, profile } = parsed.data;
    // Likes de la cookie espejo de localStorage: sólo para este pedido.
    const likes = parseLikesCookie(request.cookies.get(LIKES_COOKIE)?.value);
    return Response.json(await searchPlaces(q, { remove, filters: f, near, intent, sub, debug: Boolean(debug), likes, profile: profile !== "off" }));
  } catch (error) {
    console.error("Error en /api/search", error);
    return Response.json({ error: "No pudimos completar la búsqueda." }, { status: 500 });
  }
}
