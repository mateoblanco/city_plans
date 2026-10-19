ALTER TABLE "places" ADD COLUMN "logo_key" text;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "logo_kind" text;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "logo_bg_color" text;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "logo_color" text;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "logo_source" text;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "logo_fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_logo_kind_check" CHECK ("places"."logo_kind" in ('logo', 'local', 'food', 'person', 'other'));--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_logo_source_check" CHECK ("places"."logo_source" in ('instagram', 'owner'));--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_logo_bg_color_check" CHECK ("places"."logo_bg_color" ~ '^#[0-9a-f]{6}$');--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_logo_color_check" CHECK ("places"."logo_color" ~ '^#[0-9a-f]{6}$');