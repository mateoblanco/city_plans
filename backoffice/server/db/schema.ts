import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

// ── Tipos auxiliares ──

// PostGIS geography. Se escribe y se lee como { lng, lat }.
const geographyPoint = customType<{ data: { lng: number; lat: number }; driverData: string }>({
  dataType() {
    return "geography"; // sin typmod: SRID 4326 por defecto (drizzle-kit rompe con paréntesis)
  },
  toDriver({ lng, lat }) {
    return sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography` as unknown as string;
  },
  // Postgres devuelve el punto en EWKB hex: se leen los dos doubles.
  fromDriver(hex) {
    const buf = Buffer.from(hex, "hex");
    const le = buf[0] === 1;
    const type = le ? buf.readUInt32LE(1) : buf.readUInt32BE(1);
    const offset = type & 0x20000000 ? 9 : 5; // con SRID son 4 bytes más
    const read = (o: number) => (le ? buf.readDoubleLE(o) : buf.readDoubleBE(o));
    return { lng: read(offset), lat: read(offset + 8) };
  },
});

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

// ── Valores permitidos ──

export const PLACE_STATUS = ["draft", "published", "hidden"] as const;
export const DIET_LEVEL = ["unknown", "no", "has_options", "fully"] as const;
export const PRICE = ["unknown", "low", "moderate", "high", "very_high"] as const;
export const RESERVATIONS = ["unknown", "no_reservations", "accepts", "recommended"] as const;

const inList = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v}'`).join(", "));

// ── JSON ──

export type Localized = { es: string; en: string };

export type Hours = {
  raw?: string | null;
  display?: Localized | null;
  slots: { day: number; opens: string; closes: string | null }[];
  status: "exact" | "partial" | "vague" | "none";
  source?: "official" | "third_party" | null;
  missingReason?: string | null;
};

export type TransitLine = { line: string; stopId: string; meters: number };

// ── Tabla ──

export const places = pgTable(
  "places",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    googlePlaceId: text("google_place_id").unique(),
    slug: text("slug").notNull().unique(),
    status: text("status", { enum: PLACE_STATUS }).notNull().default("draft"),

    // Identidad y ubicación
    name: text("name").notNull(),
    address: text("address"),
    locatedIn: text("located_in"),
    neighborhoodId: text("neighborhood_id").notNull(),
    city: text("city").notNull().default("Montevideo"),
    location: geographyPoint("location").notNull(),
    coordinatesSource: text("coordinates_source").notNull().default("google"),
    coordinatesFetchedAt: timestamp("coordinates_fetched_at", { withTimezone: true }),

    // Clasificación (ids de tags.ts)
    categories: text("categories").array().notNull().default(sql`'{}'`),
    tags: text("tags").array().notNull().default(sql`'{}'`),
    // Hasta 3 ids de tags que definen al lugar; subconjunto de tags.
    signature: text("signature").array().notNull().default(sql`'{}'`),
    // Platos concretos de las fuentes, en español y minúscula.
    dishes: text("dishes").array().notNull().default(sql`'{}'`),

    // Niveles
    dietVegan: text("diet_vegan", { enum: DIET_LEVEL }).notNull().default("unknown"),
    dietVegetarian: text("diet_vegetarian", { enum: DIET_LEVEL }).notNull().default("unknown"),
    dietGlutenFree: text("diet_gluten_free", { enum: DIET_LEVEL }).notNull().default("unknown"),
    price: text("price", { enum: PRICE }).notNull().default("unknown"),
    reservations: text("reservations", { enum: RESERVATIONS }).notNull().default("unknown"),

    // Horarios
    hours: jsonb("hours").$type<Hours>().notNull().default({ slots: [], status: "none" }),

    // Contacto
    phone: text("phone"),
    whatsapp: text("whatsapp"),
    instagram: text("instagram"),
    website: text("website"),
    menuUrl: text("menu_url"),
    reservationUrl: text("reservation_url"),

    // Contenido para la UI
    descriptionEs: text("description_es"),
    descriptionEn: text("description_en"),
    highlights: jsonb("highlights").$type<Localized[]>().notNull().default([]),
    transitLines: jsonb("transit_lines").$type<TransitLine[]>().notNull().default([]),

    // Búsqueda
    embeddingText: text("embedding_text"),
    keywordText: text("keyword_text"),
    searchTsv: tsvector("search_tsv").generatedAlwaysAs(
      // El nombre pesa más (A) que el resto del texto de búsqueda (B).
      sql`setweight(to_tsvector('simple', f_unaccent(coalesce(name, ''))), 'A') || setweight(to_tsvector('simple', f_unaccent(coalesce(keyword_text, ''))), 'B')`
    ),
    embedding: vector("embedding", { dimensions: 1536 }), // text-embedding-3-small
    embeddingModel: text("embedding_model"),
    embeddingTextHash: text("embedding_text_hash"),
    embeddedAt: timestamp("embedded_at", { withTimezone: true }),

    // Control
    manualOverrides: text("manual_overrides").array().notNull().default(sql`'{}'`),
    lastExtractionId: uuid("last_extraction_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("places_status_check", sql`${t.status} in (${inList(PLACE_STATUS)})`),
    check("places_diet_vegan_check", sql`${t.dietVegan} in (${inList(DIET_LEVEL)})`),
    check("places_diet_vegetarian_check", sql`${t.dietVegetarian} in (${inList(DIET_LEVEL)})`),
    check("places_diet_gluten_free_check", sql`${t.dietGlutenFree} in (${inList(DIET_LEVEL)})`),
    check("places_price_check", sql`${t.price} in (${inList(PRICE)})`),
    check("places_reservations_check", sql`${t.reservations} in (${inList(RESERVATIONS)})`),

    index("places_location_idx").using("gist", t.location),
    index("places_tags_idx").using("gin", t.tags),
    index("places_categories_idx").using("gin", t.categories),
    index("places_signature_idx").using("gin", t.signature),
    index("places_dishes_idx").using("gin", t.dishes),
    // Búsqueda por nombre aproximada: las consultas tienen que usar f_unaccent(lower(name)).
    index("places_name_trgm_idx").using("gin", sql`f_unaccent(lower(${t.name})) gin_trgm_ops`),
    index("places_search_tsv_idx").using("gin", t.searchTsv),
    index("places_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("places_neighborhood_idx").on(t.neighborhoodId),
    index("places_status_idx").on(t.status),
  ]
);

export type Place = typeof places.$inferSelect;
export type NewPlace = typeof places.$inferInsert;