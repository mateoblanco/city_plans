# Guías: URLs planas y páginas de barrio ocultas hasta tener contenido

Nada está commiteado. No toqué `search-href.ts`, `labels.ts` ni `PlaceCard.module.scss`. No hay migraciones nuevas.

## 1. URLs

- **Todas las guías** (de barrio o de toda la ciudad) están ahora en `/guides/montevideo/<slug>`. Sale de `guideUrlPath` en `shared/guides.ts`, la única fuente, que usan la app y el backoffice.
- **La ruta vieja `/guides/montevideo/<barrio>/<slug>` ya no existe.**
  - Borré `app/guides/montevideo/[segment]/[slug]/page.tsx`.
  - El proxy no la tiene en su lista, así que da 404 real, sin redirects.
  - La vista previa con esa forma también da 404: `previewPath` sólo acepta `/guides/montevideo/<slug>`.
- **Qué se actualizó, todo saliendo de `guidePath`:**
  - links de las tarjetas;
  - canonical, Open Graph, ItemList y BreadcrumbList del JSON-LD;
  - sitemap y lista de rutas del proxy;
  - la vista previa de la app (`/guide-preview/montevideo/<slug>`) y su link en el backoffice (`GET /api/guides/:id/preview-url`).
- **El segmento `/guides/montevideo/[segment]` resuelve:** un barrio con página, o una guía con página (de barrio o de ciudad), o 404.
- **El slug de una guía sigue sin poder ser el de un barrio:** las páginas de barrio están en `/guides/montevideo/<barrio>`, al mismo nivel. La regla y su validación en el backoffice no cambiaron, y hay tests de las dos cosas.
- **Componentes:** `GuideContent` y la vista previa buscan la guía sólo por slug (`getGuidePage(slug)`, `getGuidePreview(slug)`).

## 2. El barrio como dato de la guía

- **En el editor:** el campo barrio sigue y sigue filtrando los candidatos ("Buscar lugares").
- **Etiqueta en la página de la guía:** el barrio va como chip al lado del grupo ("Cafés", "Pocitos"). Las dos etiquetas van en una lista.
- **Etiqueta en la tarjeta:** el barrio va en la línea de abajo, "Pocitos · 9 lugares". El nombre accesible de la tarjeta queda "Título, Pocitos, 9 lugares".
- **Guía sin barrio:** sin etiqueta.

## 3. Páginas de barrio ocultas

- **Constante única:** `MIN_NEIGHBORHOOD_GUIDES = 3`, en `shared/guides.ts`. La usan la app y el backoffice.
- **Qué cuenta como guía publicada:** publicada y con al menos un lugar publicado, es decir, las guías que tienen página.
  - Una publicada a la que se le despublicaron todos los lugares no tiene página, así que tampoco cuenta.
  - Si preferís contar sólo el estado "publicada", es una línea.
- **`activeNeighborhoods`** (`server/guides/catalog.ts`) decide qué barrios tienen página, y lo usan todos:
  - **página de barrio:** debajo del mínimo, `getNeighborhoodPage` da null y la página `notFound()`;
  - **proxy:** el barrio no está en la lista de rutas, así que 404 real;
  - **sitemap:** el barrio no va; sus guías sí, en su URL plana;
  - **`/guides/montevideo` › "Barrios":** sólo los que llegan al mínimo. Si ninguno llega, la sección no sale (la página ya la ocultaba con la lista vacía);
  - **params del build:** sólo barrios activos.
- **El código de la página de barrio no se tocó.** Aparece sola cuando el barrio llega a 3, cuando vence la caché (horas), igual que una guía nueva.

## 4. Migas

- **Guía:** "Guías de Montevideo / título".
- **Guía de un barrio con página activa:** "Guías de Montevideo / Pocitos / título", con el barrio como link.
- **BreadcrumbList del JSON-LD:** sale de las mismas migas, así que sigue la misma regla.
- **Vista previa:** usa los barrios activos de lo publicado. Un borrador no cuenta para el mínimo.

## 5. Backoffice

- **Aviso al lado del campo barrio:** "La página de este barrio aparece cuando tiene 3 guías publicadas (hoy: N)".
  - **N** sale de `GET /api/guides/neighborhood-counts` (`{ min, counts }`), con la misma regla que la app: publicadas con algún lugar publicado.
  - **Si ya llegó:** el aviso dice "La página de este barrio ya aparece: tiene N guías publicadas (mínimo 3)". Lo agregué para no mostrar un "aparece cuando tiene 3 (hoy: 4)". Si preferís siempre el texto original, se cambia.
  - Se lee una vez al abrir el editor.
  - El aviso va asociado al select (`aria-describedby`).
- **Introducciones:** la nota de cada barrio ahora dice "Su página aparece en la app cuando tiene 3 guías publicadas".

## Tests

- **App: 109 archivos y 1750 tests OK.** `tsc --noEmit` y `eslint` limpios.
  - **URL plana:** guías de barrio y de ciudad en `/guides/montevideo/<slug>`, también en las tarjetas.
  - **Ruta vieja 404:** `/guides/montevideo/cordon/<slug>` da 404 en el proxy, también con la clave de vista previa.
  - **Barrio debajo del mínimo:** 404 en el proxy y en `resolveCitySegment`, `getNeighborhoodPage` null, fuera del sitemap y de los params. Los casos: Pocitos con una guía con página y una sin lugares publicados; un borrador que no cuenta.
  - **Barrio que llega al mínimo:** Cordón con 3 aparece, y un barrio que pasa a 3 aparece solo. El mínimo es configurable (prueba con 1 y con 4).
  - **Sección Barrios:** sólo los que llegan; vacía si ninguno llega, también desde la base.
  - **Migas según el caso:** barrio activo con link, barrio debajo del mínimo sin barrio, ciudad sin barrio. Renderizadas y en el BreadcrumbList.
  - **Etiqueta del barrio:** en la página (sí, sí sin página del barrio, no en una de ciudad) y en la tarjeta.
  - **Choque de slugs:** un slug de barrio choca (`slugClashesWithNeighborhood`).
  - **Sitemap y vista previa:** sitemap con URLs planas y sin barrios debajo del mínimo; vista previa sólo con la forma plana.
- **Backoffice: 92 archivos y 1143 tests OK.** `tsc -b` y `oxlint` limpios.
  - URL plana en `shared` y en el link de vista previa.
  - Choque de slug con cada barrio (ya estaba).
  - `neighborhood-counts`: la ruta, y la consulta contra Postgres (PGlite), que sólo cuenta publicadas con algún lugar publicado.
  - El aviso del editor en los tres casos ("hoy: N", "ya aparece", sin barrio).

## Sin probar

- **`yarn build` + `yarn start`:** no lo corrí. El build necesita las tablas de guías en Neon (migraciones 0027 y 0028), y no sé si ya las corriste.
- **Prueba sugerida con las migraciones corridas:**
  - `/guides/montevideo/<slug>` responde 200;
  - `/guides/montevideo/<barrio>/<slug>` responde 404;
  - un barrio con menos de 3 guías responde 404 y no aparece en `/sitemap.xml` (con `ALLOW_INDEXING`).
