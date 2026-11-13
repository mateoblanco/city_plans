import type { NextRequest } from "next/server";
import { z } from "zod";
import { searchWelcomePlaces } from "@/server/welcome";

const Params = z.object({ q: z.string().trim().min(1).max(100) });

/** El buscador de la bienvenida de la home: publicados cuyo nombre contiene el texto (sin tildes ni mayúsculas). */
export async function GET(request: NextRequest) {
  const parsed = Params.safeParse({ q: request.nextUrl.searchParams.get("q") ?? "" });
  if (!parsed.success) {
    return Response.json({ error: "La búsqueda está vacía o es demasiado larga." }, { status: 400 });
  }
  try {
    return Response.json({ places: await searchWelcomePlaces(parsed.data.q) });
  } catch (error) {
    console.error("Error en /api/welcome/search", error);
    return Response.json({ error: "No pudimos completar la búsqueda." }, { status: 500 });
  }
}
