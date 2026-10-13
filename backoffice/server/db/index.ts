import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema.ts";

export const db = drizzle({ client: neon(process.env.DATABASE_URL!), schema });