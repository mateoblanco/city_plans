CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_place_id" text,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"located_in" text,
	"neighborhood_id" text NOT NULL,
	"city" text DEFAULT 'Montevideo' NOT NULL,
	"location" "geography" NOT NULL,
	"coordinates_source" text DEFAULT 'google' NOT NULL,
	"coordinates_fetched_at" timestamp with time zone,
	"categories" text[] DEFAULT '{}' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"diet_vegan" text DEFAULT 'unknown' NOT NULL,
	"diet_vegetarian" text DEFAULT 'unknown' NOT NULL,
	"diet_gluten_free" text DEFAULT 'unknown' NOT NULL,
	"price" text DEFAULT 'unknown' NOT NULL,
	"reservations" text DEFAULT 'unknown' NOT NULL,
	"hours" jsonb DEFAULT '{"slots":[],"status":"none"}'::jsonb NOT NULL,
	"phone" text,
	"whatsapp" text,
	"instagram" text,
	"website" text,
	"menu_url" text,
	"reservation_url" text,
	"description_es" text,
	"description_en" text,
	"highlights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"transit_lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"embedding_text" text,
	"keyword_text" text,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', f_unaccent(coalesce(keyword_text, '')))) STORED,
	"embedding" vector(1536),
	"embedding_model" text,
	"embedding_text_hash" text,
	"embedded_at" timestamp with time zone,
	"manual_overrides" text[] DEFAULT '{}' NOT NULL,
	"last_extraction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "places_google_place_id_unique" UNIQUE("google_place_id"),
	CONSTRAINT "places_slug_unique" UNIQUE("slug"),
	CONSTRAINT "places_status_check" CHECK ("places"."status" in ('draft', 'published', 'hidden')),
	CONSTRAINT "places_diet_vegan_check" CHECK ("places"."diet_vegan" in ('unknown', 'no', 'has_options', 'fully')),
	CONSTRAINT "places_diet_vegetarian_check" CHECK ("places"."diet_vegetarian" in ('unknown', 'no', 'has_options', 'fully')),
	CONSTRAINT "places_diet_gluten_free_check" CHECK ("places"."diet_gluten_free" in ('unknown', 'no', 'has_options', 'fully')),
	CONSTRAINT "places_price_check" CHECK ("places"."price" in ('unknown', 'low', 'moderate', 'high', 'very_high')),
	CONSTRAINT "places_reservations_check" CHECK ("places"."reservations" in ('unknown', 'no_reservations', 'accepts', 'recommended'))
);
--> statement-breakpoint
CREATE INDEX "places_location_idx" ON "places" USING gist ("location");--> statement-breakpoint
CREATE INDEX "places_tags_idx" ON "places" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "places_categories_idx" ON "places" USING gin ("categories");--> statement-breakpoint
CREATE INDEX "places_search_tsv_idx" ON "places" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "places_embedding_idx" ON "places" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "places_neighborhood_idx" ON "places" USING btree ("neighborhood_id");--> statement-breakpoint
CREATE INDEX "places_status_idx" ON "places" USING btree ("status");