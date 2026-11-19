# Primera guía de barrio: /guides/montevideo/cordon/cafes-donde-nadie-te-apura

Nada está commiteado.

**Tenés que correr la migración antes de deployar la app** (ver abajo).

**No toqué** `search-href.ts`, `labels.ts` ni `PlaceCard.module.scss`.

## Qué hay

- **Ruta:** `src/app/guides/montevideo/[barrio]/[slug]/page.tsx`.
  - Usa `generateStaticParams` y sale del archivo de guías.
  - En el build queda como **○ estática con revalidate 1h / expire 1d**. Probado con `yarn build` + `yarn start`: `x-nextjs-cache: HIT`, `Cache-Control: s-maxage=3600`.
- **Contenido** (lo editás vos): `src/server/guides/montevideo/cordon/cafes-donde-nadie-te-apura.ts`.
  - Los tipos están en `src/server/guides/types.ts`: `Guide` y `GuidePlaceEntry` con `id`, `text` y `photo?`.
  - Son planos y serializables. Pasarlo a la base es una tabla `guides` + `guide_places(position, place_id, text, photo)`.
  - El catálogo y las URLs están en `src/server/guides/catalog.ts`. El tramo del barrio sale del nombre: CORDON → `cordon`.
- **Datos** (`src/server/guides/page-data.ts`):
  - Usa `'use cache'` con `cacheTag('guides')` y `cacheLife('hours')`.
  - Hace una sola consulta SQL, solo de lugares `published` y solo con datos propios.
  - Un lugar que no vuelve de la base se saltea sin error y la numeración se recalcula (`assembleGuidePlaces`, con test).
  - Un lugar despublicado sale de la guía cuando vence la cache, es decir en horas.
  - Un cambio en el archivo necesita deploy.
- **Metadata:** título y descripción para Google, canonical, Open Graph y Twitter.
  - El robots lo hereda del layout, así que respeta `ALLOW_INDEXING`. Hoy sale `noindex, nofollow`.
  - El JSON-LD es **solo el ItemList**, sin BreadcrumbList, como pediste.
  - La guía también va al sitemap, solo con indexación activa.
- **Lo que verifiqué en el HTML servido:**
  - 9 lugares numerados del 1 al 9, dentro de `<ol>`.
  - Sin "Abierto" ni "Cerrado" en el texto.
  - Ningún dato de Google.
  - Tamaño: 67 KB, 12 KB con gzip.

## Dos cambios respecto del plan (los dos por la regla de AGENTS.md "un componente de cliente no importa nada de `src/server/`")

1. **Estado Abierto/Cerrado.**
   - El servidor arma la semana entera con los mismos textos de la ficha. Lo hace `weekStatus` en `src/server/guides/status.ts`: evalúa `placeOpenText` minuto a minuto y lo comprime en tramos.
   - El navegador solo elige el tramo de la hora actual de Montevideo, con `statusAt` y `montevideoMinuteOfWeek` de `src/lib/week-status.ts`.
   - Lo hace después de hidratar, y se actualiza cada minuto y al volver a la pestaña.
   - El HTML cacheado no trae estado y no puede quedar viejo.
   - Así no hizo falta mover lógica de `hours.ts` ni de `labels.ts`.
   - Hay un test que compara cada minuto de la semana contra `placeOpenText`.
2. **`isBot`** pasó a `src/lib/bots.ts`, la misma regla sin cambios. `server/events/bots.ts` la reexporta, así que las rutas de eventos y de la ficha no cambian.

## Diseño (`src/components/pages/GuidePage/`)

- **`GuideHeader`:**
  - Migas sin links, en un `nav` con `ol` y `aria-current`: Guías / Montevideo / Cordón.
  - El chip del grupo ("Cafés", que sale de `INTENTS`).
  - El h1 grande en `--font-display`.
  - "Actualizada el 19 de noviembre de 2026" dentro de `<time>`.
  - La introducción.
- **`GuideItem`** (componente nuevo, no la PlaceCard):
  - Número grande, logo (`PlaceImage sm`, importado sin tocar su SCSS), nombre con link a la ficha (`OriginLink origin="guide" row=<slug>`), barrio · tipo, estado y el texto.
  - El corazón es el `SaveButton` de siempre, con origen `guide`.
  - Toda la card es el link, salvo el corazón.
  - Hay un espacio opcional para foto (`photo` en el archivo). Hoy no se muestra porque ninguna tiene.
- **Resaltado:**
  - El número se rellena, aparece una barra al costado y el borde se oscurece. No depende solo del color.
  - El foco de teclado dibuja un anillo en toda la card.
  - El lugar "a la vista" lo marca un solo IntersectionObserver con una franja cerca del centro, sin escuchar el scroll.
  - Hover o foco gana sobre el que está a la vista.
  - El store sigue el patrón de `SearchPage/utils/hover.ts`: solo se re-renderizan el item y el pin que cambian.
- **Desktop (desde md):**
  - Dos columnas, con el mapa `sticky`.
  - Pines numerados (`GuideMarker`): el activo se rellena, crece y lleva anillo.
  - Hover en un pin resalta el item. Click en un pin hace scroll a su lugar y le pasa el foco.
  - El mapa usa `gestureHandling: cooperative`, para que la rueda siga scrolleando la página.
  - Se monta con `useDeferredMount` de la ficha: después del `load`, visible y con el navegador libre.
- **Mobile:**
  - Una columna y el botón "Ver mapa" fijo abajo al centro.
  - El botón abre el mapa a pantalla completa (Base UI Dialog).
  - Escape cierra y devuelve el foco al botón.
  - Tocar un pin cierra el mapa, hace scroll al lugar y le pasa el foco.
  - El chunk del mapa y Maps JS se bajan recién al abrirlo. Después queda montado, para no pagar otro mapa cada vez que se reabre.
- **Bots:** el `isBot(navigator.userAgent)` se evalúa en el cliente, así que el HTML es el mismo para todos. Para un bot no hay mapa ni botón.
- **Breakpoints:** `media(md)` es mobile-first. No hay mixins up/down en el proyecto y AGENTS.md prohíbe max-width.

## Eventos: origen `guide`

- Lo sumé a `EVENT_ORIGINS` en `shared/events.ts`, con la fila = slug de la guía, y a `ORIGIN_LABELS` en el backoffice (etiqueta "Guías").
- **Migración `backoffice/drizzle/0026_guide_origin.sql`**, junto con su snapshot y su entrada en `_journal.json`.
  - La generé con `yarn db:generate --name guide_origin`, que solo escribe archivos.
  - Hace DROP + ADD de `place_events_origin_check` con `'guide'`.
  - **No la corrí.**
- **Orden:**
  1. `yarn db:migrate` en `backoffice`.
  2. Después, el deploy de la app.
  - Si se deploya antes, los inserts con `guide` fallan el check y esos eventos se pierden en silencio.
- El test de PGlite (`events-db.test.ts`) ahora carga 0025 + 0026 y tiene un caso para `guide`.

## Archivos existentes que cambié

- `shared/events.ts`
- `backoffice/src/lib/popularity.ts`
- `backoffice/server/popularity/events-db.test.ts`
- `backoffice/drizzle/meta/_journal.json`
- `app/src/server/events/bots.ts` (pasó a reexportar)
- `app/src/server/seo/indexing.ts` y su test (guías en el sitemap)
- `app/src/app/sitemap.ts`

Todo lo demás es nuevo:
- `src/server/guides/`
- `src/components/pages/GuidePage/`
- `src/app/guides/`
- `src/lib/bots.ts`
- `src/lib/week-status.ts` y su test
- la migración

## Tests y verificación

- **App:** `yarn test` da 99 archivos y 1683 tests OK. `tsc --noEmit` y `eslint` limpios. `yarn build` OK.
  - Tests nuevos: contenido de la guía, orden y renumeración, estado semanal contra la ficha, zona horaria, JSON-LD, fecha, store del resaltado, pines.
  - Nuevo `GuidePage/test/guide-cost-guard.test.ts`. Recorre los imports de la ruta y falla si:
    - algo llega a Google Places;
    - lee `headers` o `searchParams`, o calcula la hora en el servidor;
    - el mapa se monta sin `useDeferredMount` o sin abrir el diálogo, o sin `isBot`.
- **Backoffice:** `yarn test` da 84 archivos y 1072 tests OK. `tsc -b` limpio.
- **No probé la interacción en el navegador.** La extensión de Chrome no estaba conectada. Falta revisar a mano:
  - el sticky;
  - el resaltado al scrollear;
  - hover y click en los pines;
  - "Ver mapa", Escape y tocar un pin en mobile;
  - con user agent de bot, que no aparezcan mapa ni botón.
  - Se prueba con `yarn dev` → `/guides/montevideo/cordon/cafes-donde-nadie-te-apura`.

## Contenido para revisar

Elegí 9 lugares: todos los publicados de Cordón con categoría café o panadería y el tag `work`.
- Orden: Inocencio, Sauco, Escaramuza, Culto (La Tostaduría), Cardenal, Necio, República, La Fábrica, Robusta (`robusta-cafe-2`).
- Quedaron afuera:
  - Uno Catorce: tiene wifi, pero es chiquito y de ventanita.
  - El otro Robusta de Cordón (`robusta-cafe-3`): no tiene `work`.
- Los textos usan solo lo que ya está en la base. Revisá en persona:
  - el "nadie te apura" de cada uno;
  - los DJs de Culto;
  - "un poco más caro" en Necio (es el único con precio `high`).

## Pendientes / decisiones

- Las páginas `/guias`, `/guides/montevideo` y `/guides/montevideo/cordon`. Cuando existan, se suman los links de las migas y el BreadcrumbList.
- Fotos por lugar. El slot está listo; si vienen de R2, el origen ya está habilitado en `next/image`.
- Un webhook de revalidación (`revalidateTag('guides')`) para que un despublicado salga al instante en vez de en horas.
- No lo probé, pero una URL inexistente bajo `/guides/...` probablemente tiene el mismo soft 404 de la ficha (200 + noindex con la página 404), por el shell de `cacheComponents`.
