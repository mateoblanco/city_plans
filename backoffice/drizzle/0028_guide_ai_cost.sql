-- Lo gastado en generar textos con IA para cada guía (USD): lo suma el backoffice en cada generación.
ALTER TABLE "guides" ADD COLUMN "ai_cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL;