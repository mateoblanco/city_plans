-- manual_overrides pasa de text[] (nombres de columna bloqueados) a jsonb con el valor de cada campo editado a mano.
-- Los bloqueos que había (status, instagram, review_reasons) se copian con el valor actual de la columna; los demás
-- (embedding_text, keyword_text, embedding) no los escribía nadie y se descartan.
ALTER TABLE "places" DROP CONSTRAINT "places_logo_source_check";--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "manual_overrides_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "places" SET "manual_overrides_jsonb" =
  (CASE WHEN 'status' = ANY("manual_overrides") THEN jsonb_build_object('status', "status") ELSE '{}'::jsonb END)
  || (CASE WHEN 'instagram' = ANY("manual_overrides") THEN jsonb_build_object('instagram', lower(regexp_replace("instagram", '^@', ''))) ELSE '{}'::jsonb END)
  || (CASE WHEN 'review_reasons' = ANY("manual_overrides") THEN jsonb_build_object('review_reasons', to_jsonb("review_reasons")) ELSE '{}'::jsonb END)
WHERE cardinality("manual_overrides") > 0;--> statement-breakpoint
ALTER TABLE "places" DROP COLUMN "manual_overrides";--> statement-breakpoint
ALTER TABLE "places" RENAME COLUMN "manual_overrides_jsonb" TO "manual_overrides";--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_logo_source_check" CHECK ("places"."logo_source" in ('instagram', 'owner', 'manual'));
