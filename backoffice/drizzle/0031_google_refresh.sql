-- Refresco de coordenadas de Google: avisos por lugar (place_google_flags), una fila por corrida del cron
-- (google_refresh_runs) y los motivos de revisión location_moved y not_found_in_google para "Despublicar".
CREATE TABLE "google_refresh_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"batch_size" integer NOT NULL,
	"refreshed" integer NOT NULL,
	"flagged" integer NOT NULL,
	"failed" integer NOT NULL,
	"stopped_reason" text,
	"stale_after" integer NOT NULL,
	CONSTRAINT "google_refresh_runs_stopped_reason_check" CHECK ("google_refresh_runs"."stopped_reason" is null or "google_refresh_runs"."stopped_reason" in ('authorization', 'quota', 'missing_key'))
);
--> statement-breakpoint
CREATE TABLE "place_google_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"place_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"distance_m" integer,
	"new_google_place_id" text,
	"ignored_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "place_google_flags_place_reason" UNIQUE("place_id","reason"),
	CONSTRAINT "place_google_flags_reason_check" CHECK ("place_google_flags"."reason" in ('moved', 'not_found', 'replaced'))
);
--> statement-breakpoint
ALTER TABLE "places" DROP CONSTRAINT "places_review_reasons_check";--> statement-breakpoint
ALTER TABLE "place_google_flags" ADD CONSTRAINT "place_google_flags_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "google_refresh_runs_started_idx" ON "google_refresh_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "place_google_flags_open_idx" ON "place_google_flags" USING btree ("detected_at") WHERE "place_google_flags"."ignored_at" is null and "place_google_flags"."resolved_at" is null;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_review_reasons_check" CHECK ("places"."review_reasons" <@ array['not_open_yet', 'no_place_facts', 'unconfirmed_place', 'restaurant_without_food', 'bar_without_drinks', 'low_rating', 'closed_permanently', 'closed_temporarily', 'from_discounts', 'location_moved', 'not_found_in_google']::text[]);