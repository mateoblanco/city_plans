import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema.ts";

// SQL como texto con parámetros ($1…): las consultas de popularidad, compartidas con la app (/shared/events.ts).
export const sqlClient = neon(process.env.DATABASE_URL!);

export const db = drizzle({ client: sqlClient, schema });
