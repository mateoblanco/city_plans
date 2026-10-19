Root Directory = app y activar “Include files outside the root directory in the Build Step” (por /shared).
Variables de entorno en Vercel: DATABASE_URL, AI_GATEWAY_API_KEY, NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, NEXT_PUBLIC_GOOGLE_MAP_ID y SEARCH_MODEL si se usa.
Región de las funciones: gru1 (São Paulo), junto a Neon (aws sa-east-1); está en app/vercel.json. Si se mueve la base, mover también la región.
Refresco de coordenadas de Google: hoy se guardan con coordinates_fetched_at y hay que refrescarlas antes de los 30 días. Falta un proceso que lo haga.
Atribución de Google Maps en la app donde se muestren datos de Google (el mapa ya la trae).
Revisar los términos vigentes de Google Maps Platform sobre qué se guarda.

## Logos (Cloudflare R2)
- Conectar un dominio propio al bucket `logos` (Bucket → Settings → Custom Domains), por ejemplo `logos.tudominio.com`. r2.dev tiene límite de tráfico y no usa la caché de Cloudflare: es solo para desarrollo. Después desactivar el acceso público por r2.dev.
- `LOGO_BASE_URL` en Vercel (la app arma la URL pública con la key guardada en la base), apuntando al dominio propio. Sin `/` al final.
- Si los logos se muestran con `next/image`, agregar ese dominio a `images.remotePatterns` en `next.config`.
- Las credenciales `R2_*` van solo en el `.env` local del backoffice. Nunca en Vercel ni en el cliente: la app solo lee URLs públicas.
- Como la key lleva el hash del contenido, se puede cachear para siempre: configurar `Cache-Control: public, max-age=31536000, immutable` al subir.
- Correr `yarn logos:cleanup --dry-run` de vez en cuando para ver huérfanos.

## Google Maps
- Usar un Map ID real (con el estilo que oculta los POIs), no el de demo.
- La key del navegador (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`) tiene que estar restringida por HTTP referrer al dominio de producción y a localhost, y solo a la Maps JavaScript API. Tiene que ser distinta de la key de Places del servidor.
- Poner alertas de presupuesto y cuotas en Google Cloud.

## Operación
- Neon cold start: la primera búsqueda después de un rato sin uso puede tardar. Evaluar desactivar el scale-to-zero en producción o aceptar ese costo.
- Rate limiting en `/api/search` (cada búsqueda puede llamar al LLM).
- Rotar las keys que se expusieron durante el desarrollo antes de salir.