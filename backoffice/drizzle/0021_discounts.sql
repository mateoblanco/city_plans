CREATE TABLE "discount_benefits" (
	"id" text PRIMARY KEY NOT NULL,
	"discount_place_id" text NOT NULL,
	"percent" real NOT NULL,
	"card_type" text NOT NULL,
	"card_tiers" text[] DEFAULT '{}' NOT NULL,
	"card_program" text,
	"days_kind" text NOT NULL,
	"days" text[] DEFAULT '{}' NOT NULL,
	"days_text" text,
	"mode" text NOT NULL,
	"instant_percent" real,
	"refund_percent" real,
	"cap_text" text,
	"cap_amount" numeric(12, 2),
	"cap_currency" text,
	"cap_period" text,
	"valid_from" date,
	"valid_to" date,
	"conditions" text,
	"source_text" text NOT NULL,
	"parsed_by" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "discount_benefits_card_type_check" CHECK ("discount_benefits"."card_type" in ('debit', 'credit', 'other')),
	CONSTRAINT "discount_benefits_days_kind_check" CHECK ("discount_benefits"."days_kind" in ('all', 'list', 'unknown')),
	CONSTRAINT "discount_benefits_days_check" CHECK ("discount_benefits"."days" <@ array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']::text[]),
	CONSTRAINT "discount_benefits_mode_check" CHECK ("discount_benefits"."mode" in ('instant', 'refund', 'mixed', 'unknown')),
	CONSTRAINT "discount_benefits_cap_currency_check" CHECK ("discount_benefits"."cap_currency" in ('UYU', 'USD')),
	CONSTRAINT "discount_benefits_cap_period_check" CHECK ("discount_benefits"."cap_period" in ('statement', 'month', 'week', 'day', 'purchase')),
	CONSTRAINT "discount_benefits_parsed_by_check" CHECK ("discount_benefits"."parsed_by" in ('html', 'llm'))
);
--> statement-breakpoint
CREATE TABLE "discount_place_links" (
	"discount_place_id" text NOT NULL,
	"place_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"whole_brand" boolean DEFAULT false NOT NULL,
	"score" real,
	"reasons" text[] DEFAULT '{}' NOT NULL,
	"location_index" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_place_links_discount_place_id_place_id_pk" PRIMARY KEY("discount_place_id","place_id"),
	CONSTRAINT "discount_place_links_origin_check" CHECK ("discount_place_links"."origin" in ('auto', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "discount_places" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"source_name" text NOT NULL,
	"category" text,
	"city" text,
	"departments" text[] DEFAULT '{}' NOT NULL,
	"montevideo" boolean DEFAULT false NOT NULL,
	"locations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"website" text,
	"instagram" text,
	"source_url" text NOT NULL,
	"logo_url" text,
	"description" text,
	"source_tags" text[] DEFAULT '{}' NOT NULL,
	"campaign_valid_from" date,
	"campaign_valid_to" date,
	"campaign_text" text,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"ignored" boolean DEFAULT false NOT NULL,
	"match_status" text DEFAULT 'missing' NOT NULL,
	"match_origin" text DEFAULT 'auto' NOT NULL,
	"match_candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"matched_at" timestamp with time zone,
	"last_run_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_places_match_status_check" CHECK ("discount_places"."match_status" in ('found', 'doubtful', 'missing', 'not_matched')),
	CONSTRAINT "discount_places_match_origin_check" CHECK ("discount_places"."match_origin" in ('auto', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "discount_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"reparsed_from" text,
	"providers" jsonb NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discount_benefits" ADD CONSTRAINT "discount_benefits_discount_place_id_discount_places_id_fk" FOREIGN KEY ("discount_place_id") REFERENCES "public"."discount_places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_place_links" ADD CONSTRAINT "discount_place_links_discount_place_id_discount_places_id_fk" FOREIGN KEY ("discount_place_id") REFERENCES "public"."discount_places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_place_links" ADD CONSTRAINT "discount_place_links_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discount_benefits_place_idx" ON "discount_benefits" USING btree ("discount_place_id");--> statement-breakpoint
CREATE INDEX "discount_place_links_place_idx" ON "discount_place_links" USING btree ("place_id");--> statement-breakpoint
CREATE INDEX "discount_places_provider_idx" ON "discount_places" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "discount_places_match_status_idx" ON "discount_places" USING btree ("match_status");