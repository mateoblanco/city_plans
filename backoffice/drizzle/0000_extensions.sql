-- Migración custom: tiene que correr antes de crear la tabla places.
create extension if not exists postgis;
--> statement-breakpoint
create extension if not exists vector;
--> statement-breakpoint
create extension if not exists unaccent;
--> statement-breakpoint
-- unaccent no es immutable y las columnas generadas lo exigen.
create or replace function f_unaccent(text) returns text
  language sql immutable parallel safe strict
  as $$ select public.unaccent('public.unaccent'::regdictionary, $1) $$;