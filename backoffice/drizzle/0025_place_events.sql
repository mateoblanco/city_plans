CREATE TABLE "event_salts" (
	"day" date PRIMARY KEY NOT NULL,
	"salt" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "place_event_daily" (
	"place_id" uuid NOT NULL,
	"type" text NOT NULL,
	"day" date NOT NULL,
	"total" integer NOT NULL,
	CONSTRAINT "place_event_daily_place_id_type_day_pk" PRIMARY KEY("place_id","type","day"),
	CONSTRAINT "place_event_daily_type_check" CHECK ("place_event_daily"."type" in ('view', 'save', 'directions'))
);
--> statement-breakpoint
CREATE TABLE "place_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"place_id" uuid NOT NULL,
	"type" text NOT NULL,
	"visitor" text NOT NULL,
	"day" date NOT NULL,
	"origin" text NOT NULL,
	"origin_row" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "place_events_once_per_day" UNIQUE("place_id","type","visitor","day"),
	CONSTRAINT "place_events_type_check" CHECK ("place_events"."type" in ('view', 'save', 'unsave', 'directions')),
	CONSTRAINT "place_events_origin_check" CHECK ("place_events"."origin" in ('search', 'home', 'saved', 'similar', 'branch', 'direct'))
);
--> statement-breakpoint
ALTER TABLE "place_event_daily" ADD CONSTRAINT "place_event_daily_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_events" ADD CONSTRAINT "place_events_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "place_event_daily_day_idx" ON "place_event_daily" USING btree ("day");--> statement-breakpoint
CREATE INDEX "place_events_visitor_created_idx" ON "place_events" USING btree ("visitor","created_at");--> statement-breakpoint
CREATE INDEX "place_events_day_idx" ON "place_events" USING btree ("day");