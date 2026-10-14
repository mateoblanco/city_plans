ALTER TABLE "places" ADD COLUMN "editorial_mentions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "listed_or_awarded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "ig_followers" integer;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "prominence" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "places_prominence_idx" ON "places" USING btree ("prominence");