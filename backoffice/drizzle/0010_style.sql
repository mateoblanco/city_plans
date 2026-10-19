ALTER TABLE "places" ADD COLUMN "style" text;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_style_check" CHECK ("places"."style" in ('casual', 'intermedio', 'cuidado'));