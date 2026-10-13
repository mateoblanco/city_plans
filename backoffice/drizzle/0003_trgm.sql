-- Migración custom: pg_trgm tiene que existir antes del índice trigram sobre el nombre.
create extension if not exists pg_trgm;
