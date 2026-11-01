-- Precio en tres niveles: very_high pasa a high, en la columna y en el override manual. Más la tabla de sugerencias.
CREATE TABLE "price_suggestions" (
	"place_id" uuid PRIMARY KEY NOT NULL,
	"price" text NOT NULL,
	"signal" text NOT NULL,
	"reason" text NOT NULL,
	"snippet" text,
	"source_url" text,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_suggestions_price_check" CHECK ("price_suggestions"."price" in ('low', 'moderate', 'high')),
	CONSTRAINT "price_suggestions_signal_check" CHECK ("price_suggestions"."signal" in ('menu', 'phrase', 'tags'))
);
--> statement-breakpoint
ALTER TABLE "places" DROP CONSTRAINT "places_price_check";--> statement-breakpoint
UPDATE "places" SET "price" = 'high' WHERE "price" = 'very_high';--> statement-breakpoint
UPDATE "places" SET "manual_overrides" = jsonb_set("manual_overrides", '{price}', '"high"') WHERE "manual_overrides"->>'price' = 'very_high';--> statement-breakpoint
ALTER TABLE "price_suggestions" ADD CONSTRAINT "price_suggestions_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_price_check" CHECK ("places"."price" in ('unknown', 'low', 'moderate', 'high'));