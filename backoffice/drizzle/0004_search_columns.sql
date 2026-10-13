ALTER TABLE "places" drop column "search_tsv";--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "search_tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', f_unaccent(coalesce(name, ''))), 'A') || setweight(to_tsvector('simple', f_unaccent(coalesce(keyword_text, ''))), 'B')) STORED;--> statement-breakpoint
-- Agregado a mano: el drop de search_tsv borra su índice y drizzle-kit no lo vuelve a crear.
CREATE INDEX "places_search_tsv_idx" ON "places" USING gin ("search_tsv");--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "signature" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "dishes" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX "places_signature_idx" ON "places" USING gin ("signature");--> statement-breakpoint
CREATE INDEX "places_dishes_idx" ON "places" USING gin ("dishes");--> statement-breakpoint
CREATE INDEX "places_name_trgm_idx" ON "places" USING gin (f_unaccent(lower("name")) gin_trgm_ops);