import type { NextRequest } from "next/server";
import { z } from "zod";
import { searchPlaces } from "@/server/search";

const Params = z.object({
  q: z.string().trim().min(1).max(500),
  remove: z.string().max(500).nullish(),
  debug: z.enum(["1", "true"]).nullish(),
});

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const parsed = Params.safeParse({
    q: searchParams.get("q") ?? "",
    remove: searchParams.get("remove"),
    debug: searchParams.get("debug"),
  });
  if (!parsed.success) {
    return Response.json({ error: "Falta la consulta (q) o es demasiado larga." }, { status: 400 });
  }

  try {
    const { q, remove, debug } = parsed.data;
    return Response.json(await searchPlaces(q, { remove, debug: Boolean(debug) }));
  } catch (error) {
    console.error("Error en /api/search", error);
    return Response.json({ error: "No pudimos completar la búsqueda." }, { status: 500 });
  }
}
