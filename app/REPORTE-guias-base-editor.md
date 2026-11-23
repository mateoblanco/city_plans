# Guías, tanda 1: guías en la base y editor en el backoffice

Nada está commiteado. No toqué `search-href.ts`, `labels.ts` ni `PlaceCard.module.scss`.

## Antes de deployar la app

1. **Correr la migración** en `backoffice`: `yarn db:migrate`. Aplica `drizzle/0027_guides.sql`.
   - No la corrí.
   - Antes chequeé con una consulta de solo lectura que Neon sea Postgres 18. Hace falta 15 o más para el `unique nulls not distinct` de las intros.
   - En Neon ya están aplicadas las 27 migraciones anteriores, hasta la 0026.
2. **Cargar la guía de Cordón y las dos intros** desde el backoffice (Guías › Nueva guía, Introducciones).
   - Los textos de antes siguen en git: `git show HEAD:app/src/server/guides/montevideo/cordon/cafes-donde-nadie-te-apura.ts`, `…/cordon/neighborhood.ts` y `…/montevideo/city.ts`.
   - Los ids de los lugares están en ese archivo, con el nombre en un comentario. En el editor los buscás por nombre.
3. **Configurar `GUIDES_PREVIEW_SECRET`** con la misma clave en la app (Vercel y `.env.local`) y en el backoffice (`.env.local`), más `APP_URL` en el backoffice. Las dos variables están documentadas en los `.env.example`.
4. **Recién ahí, el deploy de la app.** Sin las tablas, `yarn build` falla:
   - El error es `42P01 relation does not exist`, en "Failed to collect page data for /guides/montevideo/[segment]/[slug]". Lo probé.
   - No lo hice tolerante a propósito. Si una falla de la base se tragara en silencio, quedaría cacheada por horas una página de guías vacía.

## 1. Base (`backoffice/drizzle/0027_guides.sql`)

- **`guides`**
  - Columnas: `id`, `slug`, `city` (check `montevideo`), `neighborhood_id` (null = toda la ciudad), `group` (check `eat`, `bars`, `cafes`, `desserts`), `title`, `seo_title`, `seo_description`, `intro`, `status` (check `draft`/`published`), `featured`, `published_at`, `content_updated_at`, `created_at`, `updated_at`.
  - La intro es texto con los párrafos separados por una línea en blanco.
  - `published_at` se fija la primera vez que se publica.
  - `content_updated_at` es la fecha visible.
  - **`unique (city, slug)`**: el slug es único en toda la ciudad, también entre barrios. Así el origen `guide` de los eventos, que guarda sólo el slug, ya no puede quedar ambiguo.
- **`guide_places`**
  - Columnas: `guide_id`, `place_id`, `position` (0..n-1) y `text`.
  - PK `(guide_id, place_id)` y `unique (guide_id, position)`.
  - Cascade al borrar la guía o el lugar: si borrás un lugar en Lugares, sale de la guía.
  - Un lugar despublicado sigue en la guía y la app lo saltea, como antes.
- **`guide_intros`**: `city`, `neighborhood_id` (null = la ciudad), `intro` y `updated_at`. Una por ciudad y por barrio, con `unique nulls not distinct`.
- **Slug que choca con un barrio:**
  - No se puede expresar como constraint.
  - Lo valida el servidor del backoffice con `slugClashesWithNeighborhood` de `shared/guides.ts`, contra **todos** los barrios, tengan guías o no, y para todas las guías.
  - Lo cubren dos tests: `src/data/guides.test.ts` y el de rutas.
- **Reglas compartidas** en `shared/guides.ts`, nuevo, que usan la app y el backoffice:
  - formato del slug;
  - choque con un barrio;
  - `publishIssues`;
  - `MIN_GUIDE_PLACES` (4);
  - `STALE_AFTER_MONTHS` (6);
  - `seoDescriptionFromIntro`;
  - las rutas (`guideUrlPath`).

## 2. App

- **Se borró todo el config:** las 6 guías (la publicada y las 5 de prueba), la intro de Cordón y la de Montevideo, `GUIDES`, `visibleGuides` y `showDrafts`. No queda nada en archivos.
- **Lectura:**
  - `server/guides/db.ts` trae las guías con sus lugares en orden (`json_agg` por `position`) y un `live`, que dice si tiene algún lugar publicado. Trae también las intros.
  - `published.ts` (`publishedGuides`, `guideIntros`) y las tres páginas van con `'use cache'` + `cacheTag('guides')` + `cacheLife('hours')`. Lo que publicás aparece cuando vence la caché.
  - **Mismo diseño y comportamiento:** featured o recientes, tope 6, renumerado y grupos vacíos ocultos. Sólo cambió de dónde sale el dato.
  - El orden "del archivo" ahora es el orden de creación de la guía.
- **Una guía tiene página** si está publicada y le queda algún lugar publicado. Antes, una así daba soft 404 (200 + noindex). Ahora es 404 real, y lo mismo su barrio si no le queda otra.
- **SEO de ciudad y barrio:**
  - El h1 y el título para Google son plantilla.
  - La descripción es el comienzo de la intro: corta en la última oración que entra o, si no, en una palabra con "…", hasta 155 caracteres.
  - Sin intro, la descripción es la plantilla.
  - Cordón pierde su título propio: ahora es "Guías de Cordón, Montevideo · <nombre de la app>".
- **Fotos y portadas:** la base no las tiene. El espacio del diseño queda, pero vacío, como antes.
- **`generateStaticParams`:**
  - Sale de la base.
  - Con cacheComponents, una lista vacía rompe el build, y las tablas arrancan vacías. Por eso, sin guías devuelve un segmento centinela, `__none__`, que da `notFound()`, y el proxy le responde 404.
  - Una guía publicada después del build se arma en el primer pedido y queda cacheada.
- **Vista previa:**
  - Con `/guides/…?preview=<GUIDES_PREVIEW_SECRET>`, el proxy compara la clave en tiempo constante y reescribe a la ruta interna `app/guide-preview/[...path]`.
  - Esa ruta vuelve a chequear la clave y lee **sin caché**, también los borradores y las guías sin lugares publicados.
  - Lleva `robots: noindex, nofollow`.
  - **Sin clave** o con la clave mal, un borrador da 404 real. Un pedido directo a `/guide-preview/*` también da 404, siempre.
  - **Sin la variable** no hay vista previa.
  - **Componentes:** `GuideView` (presentación) se separó de `GuideContent`, así las dos rutas dan el mismo HTML. Las páginas públicas siguen sin leer `searchParams`, y el guard test lo exige.
- **Proxy sin consulta por pedido** (`server/guides/routes-cache.ts`):
  - Es el `createSwrCache` que ya usaba la home: memoria de la instancia → Runtime Cache de Vercel → la base, con 1 hora de vida, igual que el revalidate de `cacheLife('hours')`.
  - **Instancia nueva:** hace una consulta, y los pedidos simultáneos la comparten.
  - **Lista vencida:** sirve la vieja y la rearma una vez en segundo plano, con `event.waitUntil`.
  - **Si la base falla sin lista:** deja pasar, y queda el soft 404 de la página en vez de un 404 de algo que existe.
  - **Si falla al rearmar:** sigue la lista anterior.
  - **Desfase posible:** una guía publicada puede dar 404 hasta 1 hora en una instancia que tenga la lista vieja. Es la misma demora que la caché de las páginas.
  - **Peso del bundle:** el proxy ahora importa `swr.ts`, y con él `search/runtime-cache.ts`, que trae zod y el schema de la interpretación. El bundle del proxy es más grande que antes. No lo medí.
- **Sitemap:** sale de la base y sólo con `ALLOW_INDEXING`. Sin ella, no consulta nada, como antes. Incluye sólo guías con página.
- **Eventos:** el origen `guide` con fila = slug no cambió.

## 3. Backoffice: sección "Guías" (`#/guias`)

- **Listado:**
  - Columnas: título y slug, ciudad/barrio, grupo, estado, destacada (toggle en la fila, con "Guardando…" o el error), lugares y fecha de actualización.
  - Filtros por estado, grupo, barrio ("Toda la ciudad" o un barrio) y destacada. Se aplican en el servidor.
  - Avisos en la fila, sólo en las publicadas:
    - "Lugar despublicado: X": algún lugar con `status` distinto de `published`.
    - "N meses sin actualizar": 6 meses o más, en meses de calendario.
- **Crear y editar:**
  - **Campos:** todos (slug, barrio, grupo, título, título y descripción para Google con contadores, intro y destacada), más las fechas de publicación y de actualización como sólo lectura.
  - **Lugares:**
    - Buscador por nombre sobre los publicados (`GET /api/places?status=published`).
    - "Agregar" lo suma al final, y uno ya agregado queda deshabilitado.
    - "Sacar" renumera.
    - Cada lugar tiene su texto, y uno que dejó de estar publicado lleva una marca.
    - **No hay arrastre**, como pediste.
  - **Validación en vivo:**
    - Muestra la lista "Para publicar falta: …".
    - Publicar queda deshabilitado mientras haya problemas.
    - El servidor valida lo mismo: el slug (formato, barrio, duplicado en la ciudad → 409) y el mínimo de 4 lugares **publicados**.
    - Una guía publicada no se puede guardar incompleta: hay que despublicarla primero.
  - **Botones:**
    - **Guardar.**
    - **Publicar o Despublicar.** Guardan antes si hay cambios.
    - **Vista previa.** Guarda si hace falta, pide la URL al servidor (la clave nunca llega al navegador del backoffice) y la abre en otra pestaña.
    - La casilla **"Sólo corrección, no cambiar la fecha"**.
  - **Fecha de actualización:** cambia sola cuando cambia el contenido (textos, lugares u orden). No cambia con featured, al publicar, con un guardado sin cambios ni con la casilla marcada.
- **Introducciones:**
  - Tiene un bloque para la ciudad y uno por barrio: primero los que tienen guías o intro, después "Agregar barrio".
  - Cada bloque muestra cómo queda la descripción para Google.
  - Si se guarda vacía, se borra.
- No hay borrar guía, porque no lo pediste. Despublicar alcanza.

## Tests

- **Backoffice: 88 archivos y 1106 tests OK.** `tsc -b` y `oxlint` limpios.
  - **`server/guides/store-db.test.ts`**, contra Postgres real (PGlite) con la 0027:
    - lectura en orden;
    - renumerado sin huecos;
    - slug repetido en otro barrio → `SlugTakenError`;
    - `published_at` se fija una vez;
    - la fecha se mantiene sin `touchContent`;
    - avisos (lugar despublicado, 6 meses y sólo en publicadas);
    - cascade;
    - intros únicas con null;
    - check de grupo.
  - **`server/guides/routes.test.ts`**, con un store en memoria:
    - 503 sin base, 404, 400 con catálogos, lugar repetido;
    - slug inválido o de barrio (422) y duplicado (409);
    - publicar con 3 lugares (422) y con 4 (OK), con uno en revisión que no cuenta;
    - una publicada no baja de 4;
    - la fecha con `keepDate`, con featured y con un guardado igual;
    - vista previa (la URL con la clave, 503 sin configurar);
    - intros y filtros.
  - **`src/data/guides.test.ts`:** formato del slug, choque contra **cada** barrio, `publishIssues` y el corte de la descripción.
  - **`src/pages/guides-page.test.tsx`:**
    - avisos y filtros al servidor;
    - toggle de featured con error y vuelta atrás;
    - vacío y error con reintentar;
    - agregar, sacar y renumerar;
    - Publicar se habilita con 4;
    - publicar guarda antes, con `keepDate`;
    - slug de barrio marcado y vista previa.
- **App: 108 archivos y 1740 tests OK.** `tsc --noEmit` y `eslint` limpios.
  - **`server/guides/test/data.test.ts`**, lectura desde la base con `getSql` falso:
    - guía, barrio y ciudad como antes;
    - la consulta pública pide sólo publicadas;
    - un borrador o una guía sin lugares publicados → null;
    - la vista previa ve los borradores;
    - intro, fecha y descripción para Google;
    - ciudad sin guías.
  - **`routes.test.ts`:**
    - borrador sin clave → 404;
    - con clave → reescritura;
    - clave mal, vacía, de otro largo o sin variable → nunca;
    - `/guide-preview` directo → 404;
    - base caída → deja pasar;
    - los casos de siempre: barra final, mayúsculas, tramo de más y `__none__`.
  - **`routes-cache.test.ts`**, proxy sin consultas por pedido:
    - 20 pedidos simultáneos + 100 seguidos → **1 consulta**;
    - vencida → lista vieja y **1** rearmado en segundo plano;
    - falla sin lista → null y reintenta;
    - falla al rearmar → queda la anterior;
    - instancia nueva → Runtime Cache sin ir a la base.
  - **`catalog.test.ts`:** params con el centinela, SEO de plantilla o de intro, migas y sitemap.
  - **Guard test:** además, que ninguna página pública llegue a la vista previa, que la vista previa sea noindex, chequee la clave y lea sin caché, y que el proxy cubra `/guide-preview`.

## Capturas (backoffice, con la API mockeada)

Datos de ejemplo, no de la base. Hay un lugar en revisión y una guía vieja para que se vean los avisos.

- Listado: `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans/9d3a7bca-d9b1-4901-ac8f-41d53f48afb5/scratchpad/guias-listado.png`
- Editor, con el buscador abierto: `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans/9d3a7bca-d9b1-4901-ac8f-41d53f48afb5/scratchpad/guias-editor.png`
- Introducciones: `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans/9d3a7bca-d9b1-4901-ac8f-41d53f48afb5/scratchpad/guias-introducciones.png`

## Lo que no pude probar (necesita la migración corrida)

- `yarn build` + `yarn start` de la app con datos reales. Es el mismo diseño, pero no vi las tres páginas servidas desde la base.
- Los status reales del proxy servido: 200, 404, 307, y vista previa con y sin clave.
- El backoffice contra Neon: guardar, publicar y vista previa de punta a punta.
- Postgres local es 14 y no corre la migración. Por eso las pruebas de SQL corrieron contra PGlite.

Con la migración corrida y la guía cargada, puedo hacer esa pasada: build, `start`, `curl` de cada caso y capturas de la app.
