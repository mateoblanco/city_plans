import { connection } from "next/server";
import { welcomePlaces } from "@/server/welcome";

/** La grilla de la bienvenida de la home: 20 lugares conocidos y variados, sorteados en cada pedido de un pool cacheado. */
export async function GET() {
  // El sorteo es de cada pedido: no se prerenderiza.
  await connection();
  try {
    return Response.json({ places: await welcomePlaces() });
  } catch (error) {
    console.error("Error en /api/welcome/places", error);
    return Response.json({ error: "No pudimos cargar los lugares." }, { status: 500 });
  }
}
