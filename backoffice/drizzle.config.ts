import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  // Que drizzle-kit ignore las tablas internas de PostGIS (spatial_ref_sys, etc.)
  extensionsFilters: ["postgis"],
});