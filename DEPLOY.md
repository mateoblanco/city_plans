Root Directory = app y activar “Include files outside the root directory in the Build Step” (por /shared).
Región de las funciones: gru1 (São Paulo), junto a Neon (aws sa-east-1); está en app/vercel.json. Si se mueve la base, mover también la región.
Antes de cada deploy, correr las migraciones pendientes del backoffice (`yarn db:migrate`).
Revisar los términos vigentes de Google Maps Platform sobre qué se guarda.

## Variables de entorno en Vercel
- Solo en Production (nunca en Preview ni Development):
  - `ALLOW_INDEXING=true`
  - `TRACK_EVENTS=true`
  - `CRON_SECRET`: valor aleatorio largo, para los crons de app/vercel.json (popularidad diaria y refresco de Google).
- En todos los entornos:
  - `DATABASE_URL`
  - `AI_GATEWAY_API_KEY`
  - `GUIDES_PREVIEW_SECRET`
  - `LOGO_BASE_URL`: dominio público de los logos, sin `/` al final.
  - `GOOGLE_PLACES_API_KEY`
  - `GOOGLE_MAPS_SIGNING_SECRET`
  - `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
  - `NEXT_PUBLIC_GOOGLE_MAP_ID`: un Map ID real (con el estilo que oculta los POIs), no el de demo.

## Claves de Google
- Navegador (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`): restringida por sitio web (producción, previews y localhost) y solo a Maps JavaScript API y Maps Static API.
- Servidor (`GOOGLE_PLACES_API_KEY`): una clave separada, solo Places API (New), sin restricción de sitio.
- Cuotas diarias y alerta de presupuesto en Google Cloud.

## Infraestructura
- Dominio: `www.adondevamos.com.uy`. Redirects 308 a ese dominio desde el dominio sin www y desde `city-plans.vercel.app`.
- DNS en Cloudflare: los registros de Vercel con la nube gris (sin proxy).
- Firewall de Vercel: reglas para `/api/place-google` y para `/search` + `/api/search`.
- Search Console y Bing Webmaster Tools.

## Tipografías
- Títulos: Merriweather con `next/font`, servida desde el sitio.
- Texto: Switzer desde Fontshare.

## Logos (Cloudflare R2)
- r2.dev tiene límite de tráfico y no usa la caché de Cloudflare: es solo para desarrollo. Con el dominio propio, desactivar el acceso público por r2.dev.
- Si cambia el dominio de los logos, agregarlo a `images.remotePatterns` en `next.config`.
- Las credenciales `R2_*` van solo en el `.env` local del backoffice. Nunca en Vercel ni en el cliente: la app solo lee URLs públicas.
- Como la key lleva el hash del contenido, se puede cachear para siempre: configurar `Cache-Control: public, max-age=31536000, immutable` al subir.
- Correr `yarn logos:cleanup --dry-run` de vez en cuando para ver huérfanos.

## Operación
- Neon cold start: la primera búsqueda después de un rato sin uso puede tardar. Evaluar desactivar el scale-to-zero en producción o aceptar ese costo.
- Refresco de coordenadas de Google: cron diario `/api/cron/google-refresh` (app/vercel.json, 07:00 UTC) con `CRON_SECRET` y `GOOGLE_PLACES_API_KEY`. El control (atrasados y última corrida) está en el backoffice, Lugares › Avisos de Google.

## Pendientes
- Refresco de coordenadas de Google cada 30 días (en curso).
- Dominio propio para R2: `logos.adondevamos.com.uy` (Bucket → Settings → Custom Domains), y `LOGO_BASE_URL` apuntando a él.
- Mail del dominio.
