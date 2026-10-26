import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { ICON_CATEGORY_KEYS } from "../../src/data/icon-categories.ts";
import { STYLE_IDS } from "../../src/data/tags.ts";
import { REVIEW_REASON_IDS } from "../../src/data/review-reasons.ts";
import type { ManualOverrides } from "../../src/data/manual-overrides.ts";

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

// review: el pipeline encontró un motivo para no publicarlo (review_reasons); se publica a mano.
export const PLACE_STATUS = ["draft", "published", "review", "hidden"] as const;
export const DIET_LEVEL = ["unknown", "no", "has_options", "fully"] as const;
export const PRICE = ["unknown", "low", "moderate", "high", "very_high"] as const;
export const RESERVATIONS = ["unknown", "no_reservations", "accepts", "recommended"] as const;
export const LOGO_KIND = ["logo", "local", "food", "person", "other"] as const;
// manual: subido desde el backoffice; owner: más adelante, cuando el dueño pueda cambiar el logo.
export const LOGO_SOURCE = ["instagram", "owner", "manual"] as const;

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
    // Motivos de src/data/review-reasons.ts por los que el pipeline no lo publicó; vacío = ninguno.
    reviewReasons: text("review_reasons", { enum: REVIEW_REASON_IDS }).array().notNull().default(sql`'{}'`),

    // Identidad y ubicación
    name: text("name").notNull(),
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
    instagram: text("instagram"),
    website: text("website"),

    // Contenido para la UI
    descriptionEs: text("description_es"),
    descriptionEn: text("description_en"),
    highlights: jsonb("highlights").$type<Localized[]>().notNull().default([]),
    transitLines: jsonb("transit_lines").$type<TransitLine[]>().notNull().default([]),

    // Prominencia: seguidores del pipeline (o de signals:refresh) y el puntaje que sale de ellos.
    // Seguidores del Instagram validado (en una sucursal de cadena, los de la marca); null sin Instagram.
    igFollowers: integer("ig_followers"),
    // Sucursal de cadena: computeProminence descuenta los seguidores de la marca.
    chainBranch: boolean("chain_branch").notNull().default(false),
    // Sucursales de una misma marca (server/places/brand-key.ts): la búsqueda muestra una card por marca. null = sin marca.
    brandKey: text("brand_key"),
    // 0 a 1, de computeProminence (server/places/prominence.ts).
    prominence: real("prominence").notNull().default(0),
    // Curaduría manual desde el backoffice: el pipeline nunca lo escribe.
    featured: boolean("featured").notNull().default(false),

    // Logo en Cloudflare R2: sólo la clave; la URL pública es LOGO_BASE_URL + "/" + logo_key.
    logoKey: text("logo_key"),
    logoKind: text("logo_kind", { enum: LOGO_KIND }),
    // Hex #rrggbb: fondo (borde de la imagen) y color principal sin contar el fondo.
    logoBgColor: text("logo_bg_color"),
    logoColor: text("logo_color"),
    logoSource: text("logo_source", { enum: LOGO_SOURCE }),
    logoFetchedAt: timestamp("logo_fetched_at", { withTimezone: true }),

    // Categoría de ícono (shared/icon-categories.ts): sólo la clave; el emoji vive en código.
    // null = todavía sin categoría; el check sólo admite claves reales.
    iconCategory: text("icon_category", { enum: ICON_CATEGORY_KEYS }),
    // Estilo de la marca (shared/tags.ts STYLES): casual, intermedio o cuidado; null sin señales suficientes.
    style: text("style", { enum: STYLE_IDS }),

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
    // Campos editados a mano (src/data/manual-overrides.ts), por nombre de columna: bloquean el campo o, en tags,
    // guardan la diferencia con lo automático. Las columnas tienen siempre el valor final.
    manualOverrides: jsonb("manual_overrides").$type<ManualOverrides>().notNull().default({}),
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
    check("places_logo_kind_check", sql`${t.logoKind} in (${inList(LOGO_KIND)})`),
    check("places_logo_source_check", sql`${t.logoSource} in (${inList(LOGO_SOURCE)})`),
    check("places_logo_bg_color_check", sql`${t.logoBgColor} ~ '^#[0-9a-f]{6}$'`),
    check("places_logo_color_check", sql`${t.logoColor} ~ '^#[0-9a-f]{6}$'`),
    check("places_icon_category_check", sql`${t.iconCategory} in (${inList(ICON_CATEGORY_KEYS)})`),
    check("places_style_check", sql`${t.style} in (${inList(STYLE_IDS)})`),
    check("places_review_reasons_check", sql`${t.reviewReasons} <@ array[${inList(REVIEW_REASON_IDS)}]::text[]`),

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
    index("places_prominence_idx").on(t.prominence),
    index("places_brand_key_idx").on(t.brandKey),
  ]
);

export type Place = typeof places.$inferSelect;
export type NewPlace = typeof places.$inferInsert;