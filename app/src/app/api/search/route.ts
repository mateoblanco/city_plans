import type { NextRequest } from "next/server";
import { z } from "zod";
import { searchPlaces } from "@/server/search";

const Params = z.object({
  q: z.string().trim().max(500),
  remove: z.string().max(500).nullish(),
  f: z.string().max(500).nullish(),
  near: z.string().max(50).nullish(),
  debug: z.enum(["1", "true"]).nullish(),
});

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const parsed = Params.safeParse({
    q: searchParams.get("q") ?? "",
    remove: searchParams.get("remove"),
    f: searchParams.get("f"),
    near: searchParams.get("near"),
    debug: searchParams.get("debug"),
  });
  if (!parsed.success || (!parsed.data.q && !parsed.data.f && !parsed.data.near)) {
    return Response.json({ error: "Falta la consulta (q) o los filtros (f, near), o son demasiado largos." }, { status: 400 });
  }

  try {
    const { q, remove, f, near, debug } = parsed.data;
    return Response.json(await searchPlaces(q, { remove, filters: f, near, debug: Boolean(debug) }));
  } catch (error) {
    console.error("Error en /api/search", error);
    return Response.json({ error: "No pudimos completar la búsqueda." }, { status: 500 });
  }
}
