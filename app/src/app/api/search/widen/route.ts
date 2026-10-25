import type { NextRequest } from "next/server";
import { z } from "zod";
import { searchPlaces } from "@/server/search";

const Params = z.object({
  q: z.string().trim().max(500),
  remove: z.string().max(500).nullish(),
  f: z.string().max(500).nullish(),
  near: z.string().max(50).nullish(),
  intent: z.string().max(50).nullish(),
  sub: z.string().max(500).nullish(),
});

/**
 * Invitación a ampliar del final de la lista: cuántos lugares más saldrían sin cada filtro activo. La lista la pide
 * recién cuando se llega al final; la interpretación y el embedding salen de la cache, así que sólo cuesta SQL.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const parsed = Params.safeParse({
    q: searchParams.get("q") ?? "",
    remove: searchParams.get("remove"),
    f: searchParams.get("f"),
    near: searchParams.get("near"),
    intent: searchParams.get("intent"),
    sub: searchParams.get("sub"),
  });
  if (!parsed.success) {
    return Response.json({ error: "Algún parámetro es demasiado largo o no es válido." }, { status: 400 });
  }

  try {
    const { q, remove, f, near, intent, sub } = parsed.data;
    const response = await searchPlaces(q, { remove, filters: f, near, intent, sub, widen: true });
    return Response.json({ widen: response.widen ?? [] });
  } catch (error) {
    console.error("Error en /api/search/widen", error);
    return Response.json({ error: "No pudimos calcular cómo ampliar la búsqueda." }, { status: 500 });
  }
}
