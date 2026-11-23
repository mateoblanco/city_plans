-- Guías editoriales: guides (una por slug y ciudad), guide_places (sus lugares en orden, con el texto) y guide_intros
-- (la introducción de la ciudad y de cada barrio). Las escribe el backoffice y las lee la app. Arrancan vacías.
CREATE TABLE "guide_intros" (
	"city" text DEFAULT 'montevideo' NOT NULL,
	"neighborhood_id" text,
	"intro" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guide_intros_city_neighborhood_unique" UNIQUE NULLS NOT DISTINCT("city","neighborhood_id"),
	CONSTRAINT "guide_intros_city_check" CHECK ("guide_intros"."city" in ('montevideo'))
);
--> statement-breakpoint
CREATE TABLE "guide_places" (
	"guide_id" uuid NOT NULL,
	"place_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	CONSTRAINT "guide_places_guide_id_place_id_pk" PRIMARY KEY("guide_id","place_id"),
	CONSTRAINT "guide_places_position_unique" UNIQUE("guide_id","position")
);
--> statement-breakpoint
CREATE TABLE "guides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"city" text DEFAULT 'montevideo' NOT NULL,
	"neighborhood_id" text,
	"group" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"seo_title" text DEFAULT '' NOT NULL,
	"seo_description" text DEFAULT '' NOT NULL,
	"intro" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"content_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guides_city_slug_unique" UNIQUE("city","slug"),
	CONSTRAINT "guides_city_check" CHECK ("guides"."city" in ('montevideo')),
	CONSTRAINT "guides_group_check" CHECK ("guides"."group" in ('eat', 'bars', 'cafes', 'desserts')),
	CONSTRAINT "guides_status_check" CHECK ("guides"."status" in ('draft', 'published'))
);
--> statement-breakpoint
ALTER TABLE "guide_places" ADD CONSTRAINT "guide_places_guide_id_guides_id_fk" FOREIGN KEY ("guide_id") REFERENCES "public"."guides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_places" ADD CONSTRAINT "guide_places_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guide_places_place_idx" ON "guide_places" USING btree ("place_id");--> statement-breakpoint
CREATE INDEX "guides_status_idx" ON "guides" USING btree ("status");