ALTER TABLE "places" ADD COLUMN "brand_key" text;--> statement-breakpoint
CREATE INDEX "places_brand_key_idx" ON "places" USING btree ("brand_key");