-- El color de la franja de la tarjeta de cada guía (paleta de /shared/guide-colors.ts) y uno inicial para las que ya hay.
ALTER TABLE "guides" ADD COLUMN "color" text DEFAULT '#FF8E00' NOT NULL;--> statement-breakpoint
ALTER TABLE "guides" ADD CONSTRAINT "guides_color_check" CHECK ("guides"."color" in ('#FF8E00', '#D07B00', '#A15400', '#B94200', '#FF5C00', '#CC2C00', '#8A49FF', '#6C12DD', '#AC3FFF', '#7F06CF', '#E927F4', '#A700A9', '#FF2A8D', '#C90050', '#FF184E', '#C90030', '#FF2334', '#C20013', '#62C803', '#377210', '#00C251', '#007735', '#00B475', '#006F4D', '#00B39E', '#006D64', '#00B0D3', '#006A88', '#009DEE', '#005F9B', '#1E75FF', '#1B40DB', '#5B56FA', '#402ACC'));--> statement-breakpoint
UPDATE "guides" SET "color" = '#FF2A8D' WHERE "slug" = 'primera-cita';--> statement-breakpoint
UPDATE "guides" SET "color" = '#6C12DD' WHERE "slug" = 'noche-de-darse-un-gusto-restaurantes-caros-para-celebrar-en-montevideo';--> statement-breakpoint
UPDATE "guides" SET "color" = '#A15400' WHERE "slug" = 'cafe-entre-libros-librerias-con-cafe-para-leer-merendar-o-laburar';
