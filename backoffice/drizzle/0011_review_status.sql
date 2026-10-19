ALTER TABLE "places" DROP CONSTRAINT "places_status_check";--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "review_reasons" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_review_reasons_check" CHECK ("places"."review_reasons" <@ array['not_open_yet', 'no_place_facts', 'restaurant_without_food', 'bar_without_drinks']::text[]);--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_status_check" CHECK ("places"."status" in ('draft', 'published', 'review', 'hidden'));