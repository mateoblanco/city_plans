-- Origen 'guide' en los eventos de popularidad: clics desde las guías de barrio (/guides/...) a la ficha.
ALTER TABLE "place_events" DROP CONSTRAINT "place_events_origin_check";--> statement-breakpoint
ALTER TABLE "place_events" ADD CONSTRAINT "place_events_origin_check" CHECK ("place_events"."origin" in ('search', 'home', 'saved', 'similar', 'branch', 'direct', 'guide'));