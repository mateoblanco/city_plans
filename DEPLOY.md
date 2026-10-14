Root Directory = app y activar “Include files outside the root directory in the Build Step” (por /shared).
Variables de entorno en Vercel: DATABASE_URL, AI_GATEWAY_API_KEY, NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, NEXT_PUBLIC_GOOGLE_MAP_ID y SEARCH_MODEL si se usa.
Refresco de coordenadas de Google: hoy se guardan con coordinates_fetched_at y hay que refrescarlas antes de los 30 días. Falta un proceso que lo haga.
Atribución de Google Maps en la app donde se muestren datos de Google (el mapa ya la trae).
Revisar los términos vigentes de Google Maps Platform sobre qué se guarda.