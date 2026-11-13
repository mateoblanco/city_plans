import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
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
import {
  BENEFIT_MODES,
  CAP_CURRENCIES,
  CAP_PERIODS,
  CARD_TYPES,
  MATCH_ORIGINS,
  MATCH_STATUSES,
  WEEKDAYS,
  type DiscountPlaceSearch,
  type DiscountRunError,
  type DiscountRunProvider,
  type MatchCandidate,
  type ProviderPlaceLocation,
} from "../../src/types/discounts.ts";

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
// Relativo a lo habitual para el tipo de lugar (cortes en server/providers/price-tiers.ts).
export const PRICE = ["unknown", "low", "moderate", "high"] as const;
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
  source?: "official" | "third_party" | "manual" | null;
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

// Precio sugerido por `yarn prices:suggest --write` (server/places/price-suggestion.ts): no toca places.price; la tabla
// de Lugares lo muestra si difiere y aceptarlo lo guarda como override price; descartarlo pone dismissed_at y deja de
// mostrarse. Cada corrida con --write la reemplaza, conservando el descarte si vuelve a sugerir el mismo precio.
export const PRICE_SUGGESTION_SIGNAL = ["menu", "phrase", "tags"] as const;
export const priceSuggestions = pgTable(
  "price_suggestions",
  {
    placeId: uuid("place_id").primaryKey().references(() => places.id, { onDelete: "cascade" }),
    price: text("price", { enum: PRICE }).notNull(),
    signal: text("signal", { enum: PRICE_SUGGESTION_SIGNAL }).notNull(),
    reason: text("reason").notNull(),
    // Fragmento de la fuente (web, Instagram o Exa; nunca Google), con el precio si salió de la carta.
    snippet: text("snippet"),
    sourceUrl: text("source_url"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  },
  (t) => [
    check("price_suggestions_price_check", sql`${t.price} in ('low', 'moderate', 'high')`),
    check("price_suggestions_signal_check", sql`${t.signal} in (${inList(PRICE_SUGGESTION_SIGNAL)})`),
  ]
);

// ── Descuentos (server/discounts/) ──
// Los proveedores están en código (server/discounts/providers.ts). Cada corrida hace upsert por id estable: lo que no
// aparece queda inactivo (no se borra) y vuelve a activarse si reaparece. Un proveedor que falla entero no toca nada.

export const DAYS_KINDS = ["all", "list", "unknown"] as const;
export const PARSED_BY = ["html", "llm"] as const;

// Un lugar de un proveedor (banco, billetera…), con id `${proveedor}:${slug de la fuente}`.
export const discountPlaces = pgTable(
  "discount_places",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id").notNull(),
    sourceName: text("source_name").notNull(),
    category: text("category"),
    city: text("city"),
    departments: text("departments").array().notNull().default(sql`'{}'`),
    montevideo: boolean("montevideo").notNull().default(false),
    locations: jsonb("locations").$type<ProviderPlaceLocation[]>().notNull().default([]),
    website: text("website"),
    instagram: text("instagram"),
    sourceUrl: text("source_url").notNull(),
    logoUrl: text("logo_url"),
    description: text("description"),
    sourceTags: text("source_tags").array().notNull().default(sql`'{}'`),
    campaignValidFrom: date("campaign_valid_from", { mode: "string" }),
    campaignValidTo: date("campaign_valid_to", { mode: "string" }),
    campaignText: text("campaign_text"),

    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    // Apareció en la última corrida del proveedor que terminó bien.
    active: boolean("active").notNull().default(true),
    // Descartado (no es para salir a comer o tomar algo): no se vuelve a cruzar ni se muestra por defecto.
    ignored: boolean("ignored").notNull().default(false),
    // Quién decidió: null = nadie (manda la regla de rubros), auto = la regla (config autoDiscard), manual = a mano
    // (descartado o "volver a mostrar"): la regla no lo toca más.
    ignoredOrigin: text("ignored_origin", { enum: MATCH_ORIGINS }),
    // Motivo del descarte automático ("Rubro: Carnicería").
    ignoredReason: text("ignored_reason"),

    // Cruce: manual = lo corrigió alguien y ninguna corrida lo toca. Los vínculos están en discount_place_links.
    matchStatus: text("match_status", { enum: MATCH_STATUSES }).notNull().default("missing"),
    matchOrigin: text("match_origin", { enum: MATCH_ORIGINS }).notNull().default("auto"),
    matchCandidates: jsonb("match_candidates").$type<MatchCandidate[]>().notNull().default([]),
    matchedAt: timestamp("matched_at", { withTimezone: true }),

    // Búsqueda en Google de los que no están en la base (pantalla Descuentos), una por local. De Google sólo place_id y
    // coordenadas. Las corridas de descuentos no la tocan.
    placeSearches: jsonb("place_searches").$type<DiscountPlaceSearch[]>().notNull().default([]),

    lastRunId: text("last_run_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("discount_places_match_status_check", sql`${t.matchStatus} in (${inList(MATCH_STATUSES)})`),
    check("discount_places_match_origin_check", sql`${t.matchOrigin} in (${inList(MATCH_ORIGINS)})`),
    check("discount_places_ignored_origin_check", sql`${t.ignoredOrigin} is null or ${t.ignoredOrigin} in (${inList(MATCH_ORIGINS)})`),
    index("discount_places_provider_idx").on(t.providerId),
    index("discount_places_match_status_idx").on(t.matchStatus),
  ]
);

// Vínculo lugar del proveedor ↔ lugar nuestro: uno a muchos (un lugar del banco puede ser varias sucursales nuestras).
export const discountPlaceLinks = pgTable(
  "discount_place_links",
  {
    discountPlaceId: text("discount_place_id").notNull().references(() => discountPlaces.id, { onDelete: "cascade" }),
    placeId: uuid("place_id").notNull().references(() => places.id, { onDelete: "cascade" }),
    origin: text("origin", { enum: MATCH_ORIGINS }).notNull(),
    // Vinculado por ser de la marca (la fuente no dice la sucursal), no por una dirección.
    wholeBrand: boolean("whole_brand").notNull().default(false),
    score: real("score"),
    reasons: text("reasons").array().notNull().default(sql`'{}'`),
    // Qué dirección de discount_places.locations cruzó (índice); null si no salió de una dirección.
    locationIndex: integer("location_index"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.discountPlaceId, t.placeId] }),
    check("discount_place_links_origin_check", sql`${t.origin} in (${inList(MATCH_ORIGINS)})`),
    index("discount_place_links_place_idx").on(t.placeId),
  ]
);

// Un beneficio, con id estable (lugar, tipo de tarjeta, niveles y programa; sin el porcentaje).
export const discountBenefits = pgTable(
  "discount_benefits",
  {
    id: text("id").primaryKey(),
    discountPlaceId: text("discount_place_id").notNull().references(() => discountPlaces.id, { onDelete: "cascade" }),
    percent: real("percent").notNull(),
    cardType: text("card_type", { enum: CARD_TYPES }).notNull(),
    cardTiers: text("card_tiers").array().notNull().default(sql`'{}'`),
    // Sólo con esa tarjeta co-branded ("Nacional"); null = cualquiera del tipo.
    cardProgram: text("card_program"),
    // all: sin restricción; list: los de days; unknown: no se pudo determinar (ver days_text).
    daysKind: text("days_kind", { enum: DAYS_KINDS }).notNull(),
    days: text("days").array().notNull().default(sql`'{}'`),
    daysText: text("days_text"),
    mode: text("mode", { enum: BENEFIT_MODES }).notNull(),
    instantPercent: real("instant_percent"),
    refundPercent: real("refund_percent"),
    capText: text("cap_text"),
    capAmount: numeric("cap_amount", { precision: 12, scale: 2, mode: "number" }),
    capCurrency: text("cap_currency", { enum: CAP_CURRENCIES }),
    capPeriod: text("cap_period", { enum: CAP_PERIODS }),
    validFrom: date("valid_from", { mode: "string" }),
    validTo: date("valid_to", { mode: "string" }),
    conditions: text("conditions"),
    sourceText: text("source_text").notNull(),
    // La página del proveedor de la que salió (Itaú: Restaurantes o Platinum).
    sourceUrl: text("source_url"),
    parsedBy: text("parsed_by", { enum: PARSED_BY }).notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    // Apareció en la última lectura de su detalle y no estaba vencido. Al leer, además, valid_to < hoy cuenta como inactivo.
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    check("discount_benefits_card_type_check", sql`${t.cardType} in (${inList(CARD_TYPES)})`),
    check("discount_benefits_days_kind_check", sql`${t.daysKind} in (${inList(DAYS_KINDS)})`),
    check("discount_benefits_days_check", sql`${t.days} <@ array[${inList(WEEKDAYS)}]::text[]`),
    check("discount_benefits_mode_check", sql`${t.mode} in (${inList(BENEFIT_MODES)})`),
    check("discount_benefits_cap_currency_check", sql`${t.capCurrency} in (${inList(CAP_CURRENCIES)})`),
    check("discount_benefits_cap_period_check", sql`${t.capPeriod} in (${inList(CAP_PERIODS)})`),
    check("discount_benefits_parsed_by_check", sql`${t.parsedBy} in (${inList(PARSED_BY)})`),
    index("discount_benefits_place_idx").on(t.discountPlaceId),
  ]
);

// Cada corrida: resumen por proveedor (lugares, pedidos, costo del modelo), errores parciales y avisos.
export const discountRuns = pgTable("discount_runs", {
  id: text("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
  reparsedFrom: text("reparsed_from"),
  providers: jsonb("providers").$type<DiscountRunProvider[]>().notNull(),
  errors: jsonb("errors").$type<DiscountRunError[]>().notNull().default([]),
  warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
});

export type Place = typeof places.$inferSelect;
export type NewPlace = typeof places.$inferInsert;