ALTER TABLE "discount_places" ADD COLUMN "ignored_origin" text;--> statement-breakpoint
ALTER TABLE "discount_places" ADD COLUMN "ignored_reason" text;--> statement-breakpoint
ALTER TABLE "discount_places" ADD CONSTRAINT "discount_places_ignored_origin_check" CHECK ("discount_places"."ignored_origin" is null or "discount_places"."ignored_origin" in ('auto', 'manual'));--> statement-breakpoint
UPDATE "discount_places" SET "ignored_origin" = 'manual' WHERE "ignored";