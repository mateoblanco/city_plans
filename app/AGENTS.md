<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Búsqueda

- La lógica vive en `src/server/search/` (sólo servidor): `searchPlaces(query, { remove, debug })` para server components y `GET /api/search?q=&remove=&debug=1`.
- Lee la tabla `places` de Neon que llena el backoffice (sólo `status = 'published'`). El esquema y las migraciones son del backoffice; acá va SQL crudo.
- Tags y barrios vienen de `../shared` (alias `@shared/*`), compartidos con el backoffice. No los copies.
- Pesos, umbrales y modelo están todos en `src/server/search/config.ts`.
- Calidad: `prominence` y `featured` (los escribe el backoffice) multiplican el puntaje final (RRF + empujones) dentro de cada nivel, sin cruzarlos (`SEARCH_CONFIG.quality`). `wantsBest` ("el mejor", "best", "top", desde el modelo o el atajo) amplía el rango; no es filtro, chip ni unrecognized. `featured` suma el motivo "Recomendado"; `prominence` nunca se muestra fuera de debug.
- Comandos: `yarn test` y `yarn search:eval [--debug] [consulta…]` (corre el set de prueba contra Neon y el AI Gateway).
- Claves sólo en `.env.local` (ver `.env.example`), nunca con prefijo `NEXT_PUBLIC_`. Única excepción: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` y `NEXT_PUBLIC_GOOGLE_MAP_ID`, del mapa de `/search`; la clave es de navegador y va restringida por referrer.
- `/search`: lista a la izquierda y mapa fijo a la derecha (`MapSync` guarda el `hoveredId` compartido; `SearchMap` se carga sólo en el cliente). Sólo desktop por ahora.


antes de cualquier deploy, hay que revisar DEPLOY.md.