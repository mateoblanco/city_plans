# Guías: página de ciudad, guías de toda la ciudad, migas y /guides

Nada está commiteado. No toqué `search-href.ts`, `labels.ts` ni `PlaceCard.module.scss`.

La migración `0026_guide_origin` sigue pendiente de la primera tanda: primero `yarn db:migrate` en `backoffice`, después el deploy.

## 1. Guías de toda la ciudad

- **Config:** en `server/guides/types.ts`, `neighborhood` pasó a ser opcional. Una guía sin barrio es de toda Montevideo y su URL es `/guides/montevideo/<slug>`, al mismo nivel que los barrios.
- **Ruta:** Next no permite dos segmentos dinámicos hermanos, así que la carpeta `[barrio]` pasó a llamarse **`[segment]`**.
  - `app/guides/montevideo/[segment]/page.tsx` resuelve con `resolveCitySegment`: **primero el barrio** (si tiene guías visibles), **después la guía de ciudad**, y si no hay ninguno, 404.
  - `app/guides/montevideo/[segment]/[slug]/page.tsx` sigue siendo la guía de barrio.
  - Las dos se prerenderizan: `generateStaticParams` incluye barrios y guías de ciudad.
- **Choque de slugs:** `citySlugClashes()` en `catalog.ts`. El test exige que sea vacío y compara contra **todos** los barrios de `NEIGHBORHOOD_NAMES`, tengan guías o no, para que una guía de ciudad tampoco choque con un barrio que sume guías más adelante. Otro test comprueba que detecta un choque: con guías de ciudad llamadas `pocitos` y `ciudad-vieja`, las marca.
- **Página:** es la misma de la guía (mapa, lista numerada, estado y guardado). Se reusa con `GuideContent` (`barrio: null`). Las migas van sin barrio.
- **Marco común:** el de las tres páginas (saltos, header y `<main>` con Suspense) quedó en `components/GuidesShell`.

## 2. /guides/montevideo

- **Encabezado:** el h1 "Guías de Montevideo" y la introducción salen de `server/guides/montevideo/city.ts` (borrador para que lo ajustes). No tiene migas, porque es la raíz.
- **Filas:**
  - Grupos en el orden Comer, Tomar algo, Cafés, Postres, con el mismo `GuideRow` y `GuideCard` del barrio. Los moví a `components/GuideRow/` porque ahora los usan dos páginas; no cambió nada adentro.
  - Mezclan guías de barrio y de ciudad.
- **Qué guías van** (`pickGroupGuides` y `pickCityGroups` en `server/guides/city.ts`):
  - Las `featured: true` del grupo, en el orden del archivo.
  - Si el grupo no tiene ninguna destacada, las más recientes por `updatedAt`; a igual fecha, en el orden del archivo.
  - Hasta 6 por grupo.
  - Una guía sin lugares publicados no cuenta, ni para elegir.
  - Un grupo sin guías no se muestra.
  - Marqué `featured: true` en "Cafés donde nadie te apura", así en dev se ven los dos casos: Cafés por destacada, Comer por recientes.
- **Barrios** (`NeighborhoodGrid` y `NeighborhoodCard`, nuevos):
  - Una tarjeta por barrio que tenga al menos una guía con lugares publicados, que es la misma condición que evita el 404 de su página.
  - Solo lleva el nombre y una flecha decorativa, y es un link a `/guides/montevideo/<barrio>`.
  - Orden alfabético en español (`Intl.Collator('es')`).
  - Grilla de 2 columnas en mobile; desde md, las que entren.
  - Usa los tokens de las cards: superficie, borde, sombra, radio de 16 px, anillo de foco hacia adentro y borde oscuro en hover.
- **Render** (`getCityPage` en `server/guides/city-data.ts`):
  - `'use cache'`, `cacheTag('guides')` y `cacheLife('hours')`, con una sola consulta a la base.
  - Sin Google ni personalización.
  - En el build queda **○ estática, revalidate 1h**.
- **Metadata:** "Guías de Montevideo: dónde comer, tomar algo y cafés · Salimos", con canonical `/guides/montevideo` y Open Graph. Respeta `ALLOW_INDEXING` a través del layout.
- **JSON-LD:** `CollectionPage` con `mainEntity: ItemList` de las guías, en el orden de la página.

## 3. /guides → /guides/montevideo (307)

- Lo hace el proxy: `guideProxyAction` devuelve `redirect`, y responde 307 sin renderizar nada.
- Además, `app/guides/page.tsx` tiene `redirect()` como respaldo por si el proxy no corriera.
- `/guides` no va al sitemap.

## 4. Migas y BreadcrumbList

| Página | Migas visibles | BreadcrumbList |
|---|---|---|
| Ciudad | ninguna | no (CollectionPage) |
| Barrio | **Guías de Montevideo** (link) / Cordón (actual) | 2 tramos |
| Guía de barrio | **Guías de Montevideo** (link) / **Cordón** (link) / título (actual) | 3 tramos |
| Guía de ciudad | **Guías de Montevideo** (link) / título (actual) | 2 tramos |

- Las arman `neighborhoodBreadcrumb` y `guideBreadcrumb` en `catalog.ts`, con URLs reales.
- El JSON-LD sale de `breadcrumbJsonLd` en `components/GuideBreadcrumb/utils/structured-data.ts`, con URLs absolutas.
- En barrio y guía, el `<script>` lleva un array con `[ItemList, BreadcrumbList]`.

## 5. Proxy y sitemap

- **Proxy:** `guideRoutes()` ahora conoce la ciudad, los barrios con guías y todas las guías visibles (de barrio y de ciudad).
  - Lo que no existe y los borradores en producción dan **404 real**.
  - `/guides` redirige.
  - `/guides/montevideo` responde 200.
  - Sigue sin consultar la base, y el matcher sigue siendo solo `/guides/:path*`.
- **Sitemap** (`guideSitemapPages`, solo con `ALLOW_INDEXING`), en este orden:
  1. `/guides/montevideo`, con la fecha de la guía más nueva.
  2. Cada barrio, con la de su guía más nueva, seguido de sus guías.
  3. Al final, las guías de ciudad.
  - Sin borradores en el build.

## Borradores que armé (solo con `next dev`)

| Guía | Ámbito | Grupo | Lugares |
|---|---|---|---|
| Lugares de sushi para una cita (`montevideo/sushi-para-una-cita.ts`) | Toda la ciudad | Comer | Umami Sushi, Naru Sushi Bar, Nagasaki Sushi, Meraki |
| Brunch en Pocitos (`montevideo/pocitos/brunch-en-pocitos.ts`) | Pocitos | Comer | Fragolina, Plantado, Jesusa Almacén, Café del Jardín |

- Son lugares publicados de la base. Los textos son cortos y salen de su descripción.
- Pocitos no tiene texto propio en el config, así que su página usa el título y la descripción genéricos y no tiene introducción.
- Los tres borradores de Cordón de la tanda anterior siguen ahí.

## Verificación

- **Tests de la app:** `yarn test` da 108 archivos y 1751 tests OK. `tsc --noEmit` y `yarn lint` limpios. `yarn build` OK.
  - **Featured y fallback:** solo las destacadas, en orden; si no hay, las recientes, con desempate por el orden del archivo; tope de 6. Una destacada sin lugares hace caer el grupo a las recientes. Mezcla de barrio y ciudad.
  - **Barrios solo con guías:** se excluye un barrio cuyas guías no tienen publicados. Se ordena alfabéticamente con tildes, por ejemplo Aguada, Ituzaingó, Jacinto Vera.
  - **Choque de slugs:** contra todos los barrios, y el chequeo detecta un choque.
  - **Resolución:** primero el barrio, después la guía de ciudad.
  - **Redirect:** `guideProxyAction('/guides')` devuelve `redirect`, también con barra final.
  - **Migas renderizadas:** con `react-dom/server`, las cuatro páginas: ciudad sin migas, barrio, guía de barrio y guía de ciudad.
  - **JSON-LD:** BreadcrumbList con posiciones y URLs absolutas; CollectionPage con ItemList.
  - **Borradores ocultos:** en producción no aparecen en params, sitemap, proxy, la página de ciudad ni en Barrios (Pocitos no sale). En dev, sí.
  - **Datos con base mockeada:** en producción, ciudad = Cafés + Cordón; en dev, los 4 grupos + Cordón y Pocitos.
  - **Guard test:** ahora recorre también `[segment]` y la ciudad. Comprueba que no hay Google ni datos del pedido, que todo está cacheado y que barrio y ciudad no tienen mapa.
- **Producción servida** (`yarn build` + `yarn start`):
  - `/guides`: **307** a `/guides/montevideo`.
  - **200:** `/guides/montevideo`, `/guides/montevideo/cordon` y la guía publicada.
  - **404 real:** `/guides/montevideo/sushi-para-una-cita`, `/pocitos` y `/pocitos/brunch-en-pocitos` (borradores), además de `/guides/montevideo/xyz` y `/guides/montevideo/cordon/xyz`.
  - En el HTML de las tres páginas revisé título, canonical, migas con sus links y JSON-LD; están como en las tablas de arriba.
- **Latencia** (local, mediana / p95 de 300 pedidos):

  | Ruta | Tiempo |
  |---|---|
  | `/guides/montevideo` | 0,74 / 0,99 ms |
  | Barrio | 0,69 / 0,87 ms |
  | Guía | 0,72 / 0,91 ms |
  | 404 | 0,57 / 0,79 ms |
  | Redirect `/guides` | 0,36 / 0,45 ms |
  | `/place` (fuera del proxy) | 2,11 / 2,71 ms, igual que antes |

  - Lo mismo que en la tanda anterior.
  - Sigue valiendo la advertencia de Vercel: allá el proxy es una invocación por pedido. Hay que medirlo en un preview.
- **Lighthouse** (`/guides/montevideo`, build de producción):

  | | Performance | Accesibilidad | Buenas prácticas | SEO |
  |---|---|---|---|---|
  | Mobile | 98 (LCP 2,3 s, CLS 0,037) | 100 | 96 | 66 |
  | Desktop | 100 (LCP 0,5 s, CLS 0,009) | 100 | 96 | 66 |

  - **SEO:** sale 66 solo por el `noindex` (`ALLOW_INDEXING` apagado).
  - **Buenas prácticas:** sale 96 por los scripts de Vercel Analytics y Speed Insights, que en local dan 404.
  - **CLS de mobile, 0,037:** lo causa la carga de la fuente (Fontshare), según Lighthouse: "Web font loaded". El título y la intro cambian de alto al cambiar la fuente y bajan las filas. Está debajo del umbral de 0,1. Es el mismo efecto global de las fuentes del sitio; se arreglaría para todo el sitio con una fuente de respaldo ajustada (`size-adjust`), no en esta página.
- **Capturas** (dev con borradores, contra tu `next dev` del puerto 3000, solo lectura):
  - Desktop 1440 px: `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans/511451fa-cdbb-452f-9892-8a604dc6487c/scratchpad/ciudad-desktop.png`
  - Mobile 412 px, página completa: `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans/511451fa-cdbb-452f-9892-8a604dc6487c/scratchpad/ciudad-mobile.jpg`. Se ve el scroll horizontal de Comer, con 3 guías.

## Notas / pendientes

- **Popularidad:** el origen `guide` guarda como fila (`origin_row`) solo el slug de la guía. Si dos barrios llegan a tener una guía con el mismo slug, en los eventos no se distinguen. Hoy no pasa. Se podría guardar `<barrio>/<slug>`, dentro del límite de 40 caracteres, o exigir slugs únicos en todo el config.
- **`/guides`** puede pasar a ser un selector de ciudades: se saca el `redirect` del proxy y de `app/guides/page.tsx`.
- **El soft 404 de `/place`** sigue para después. La propuesta está en `REPORTE-guias-barrio.md`, sección 3.
