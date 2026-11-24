# Guías: URLs en inglés y página de barrio

Nada está commiteado. No toqué `search-href.ts`, `labels.ts` ni `PlaceCard.module.scss`. La migración `0026_guide_origin` sigue pendiente de la tanda anterior: primero `yarn db:migrate` en `backoffice`, después el deploy de la app.

## 1. URLs en inglés

- `/guias` pasó a `/guides`:
  - Guía: `/guides/montevideo/cordon/cafes-donde-nadie-te-apura`.
  - Barrio: `/guides/montevideo/cordon`.
- Los prefijos van en inglés; el barrio y el slug, en español.
- No hay redirects: `/guias/...` responde 404 real.
- Lo que cambió con el prefijo:
  - Las rutas viven en `src/app/guides/`.
  - `neighborhoodPath` y `guidePath` en `server/guides/catalog.ts`, de donde salen links, canonical, Open Graph, JSON-LD y sitemap.
  - Los tests.
  - Los ids de ancla de los lugares de la guía, que ahora son `#guide-<id>` (antes `#guia-<id>`).
  - El reporte anterior (`REPORTE-guia-cordon-cafes.md`), corregido para que no lleve a URLs viejas.

### Lo que sigue en español en las URLs (no lo cambié)

Las rutas (`/`, `/search`, `/place/[slug]`, `/api/...`) y los nombres de los parámetros (`q`, `f`, `loc`, `remove`, `intent`, `sub`, `debug`, `profile`, `now`) ya están en inglés. Quedan en español algunos **valores** y **anclas**:

1. **Estilo en `remove`:** `remove=prefer:intermedio` y `remove=prefer:cuidado`. Son los ids de `STYLES` en `shared/tags.ts`; `casual` sirve en los dos idiomas.
2. **Chips de texto en `remove`:** son lo que escribió la persona, así que suelen quedar en español.
   - `dish:<plato>`, por ejemplo `dish:milanesa`.
   - `venue:<located_in>`, por ejemplo `venue:Mercado del Puerto`.
   - `name:<texto>`.
3. **Barrios en `f`:** `f=neighborhood:CORDON`. Son los ids del shapefile del INE, en mayúsculas y en español. Algunos tienen la codificación rota del archivo original: `BAÑADOS DE CARRASCO`, `FLOR DE MAROÑAS`.
4. **Anclas de los skip links** (aparecen en la URL al usarlos): `#contenido`, `#resultados` y `#mapa` (`SKIP_TARGETS`).
5. **Slugs de las fichas:** `/place/inocencio-cafe`, `/place/croissanteria-la-fabrica`. Salen del nombre del lugar. Los de las guías son en español a propósito.

## 2. Página de barrio: `/guides/montevideo/[barrio]`

- **Datos** (`server/guides/neighborhood-data.ts`, `getNeighborhoodPage`):
  - Salen de las guías visibles de ese barrio.
  - Hace una sola consulta SQL, con los lugares publicados de todas esas guías, y solo datos propios.
  - Usa `'use cache'`, `cacheTag('guides')` y `cacheLife('hours')`, igual que la guía.
  - `generateStaticParams` incluye solo los barrios con alguna guía visible.
  - En el build: `○ /guides/montevideo/cordon`, revalidate 1h / expire 1d.
- **Cuándo da 404:**
  - Si el barrio no tiene guías: 404 real, por el proxy (ver 3).
  - Si ninguna de sus guías tiene lugares publicados: la página 404 de la app, pero con status 200 + noindex (el proxy no ve la base).
- **Grupos** (`groupGuides` en `server/guides/neighborhood.ts`):
  - Orden: Comer, Tomar algo, Cafés, Postres (`GUIDE_GROUPS`; las etiquetas salen de `INTENTS`).
  - Dentro de cada grupo, las guías van en el orden del archivo.
  - Una guía sin lugares publicados no sale.
  - Un grupo sin guías no se muestra.
- **Texto del barrio:** va en `server/guides/montevideo/cordon/neighborhood.ts`, con `intro`, `seoTitle` y `seoDescription`.
  - Borrador para Cordón: *"Cordón es de los barrios con más para salir en Montevideo: cafés de especialidad, cervecerías artesanales y bares de tapas, muchos en casonas viejas y talleres reciclados, entre 18 de Julio y calles más tranquilas."*
  - Título para Google: "Guías de Cordón, Montevideo: cafés, bares y dónde comer · Salimos".
  - Un barrio sin texto propio usa un título y una descripción genéricos.
- **Diseño** (`components/pages/GuideNeighborhoodPage/`):
  - Arriba van las migas en texto (Guías / Montevideo / Cordón), con `aria-current` en Cordón. Después, el barrio en grande en `--font-display` y la introducción.
  - **`GuideRow`:**
    - Es un `<section aria-labelledby>` con su `h2`.
    - Mobile: scroll horizontal de borde a borde. El degradado de la derecha es **`RowScroller` de la home**, el mismo componente que usan las filas de lugares y los platos. Se reusa porque es justo el comportamiento pedido. No reusé `PlaceRow` ni `ViewAllCard`.
    - Desde md: grilla sin scroll.
  - **`GuideCard`** (componente nuevo):
    - Muestra los logos encimados de los primeros 3 lugares publicados (decorativos, `aria-hidden`), el título y "9 lugares" / "1 lugar".
    - Toda la tarjeta es el link. Su nombre accesible es "Cafés donde nadie te apura, 9 lugares".
    - El foco se marca con un anillo hacia adentro.
    - Tiene un espacio opcional para portada (`cover` en la guía). Hoy no se muestra.
- **Migas compartidas:** `components/GuideBreadcrumb`. En la página de la guía, "Cordón" ahora es un link a `/guides/montevideo/cordon`, subrayado.
- **SEO:**
  - Título y descripción, canonical y Open Graph.
  - Respeta `ALLOW_INDEXING`: hoy sale `noindex, nofollow`.
  - El JSON-LD es un **ItemList de las guías**, en el orden de la página, sin BreadcrumbList.
  - El sitemap (con indexación activa) suma el barrio, con la fecha de su guía más nueva, y después sus guías (`server/guides/sitemap.ts`).
- **Breakpoints:** todo es `media(md)`, mobile-first. En el proyecto no hay mixins up/down y AGENTS.md no permite max-width.

## Borradores de prueba (solo con `next dev`)

`draft: true` en la guía. `visibleGuides()` los deja pasar solo con `NODE_ENV=development`. En producción y en el build no existen: no tienen página ni params, no aparecen como tarjeta y no van al sitemap. Si se piden en producción, dan **404 real** (por el proxy, ver 3). En dev, la página del borrador lleva además `noindex`.

| Grupo | Guía (archivo en `server/guides/montevideo/cordon/`) | Lugares |
|---|---|---|
| Comer | Para compartir con amigos (`para-compartir.ts`) | Demorondanga Bar, Inmigrantes MVD, Malevo Bar |
| Tomar algo | Cervezas artesanales en Cordón (`cervezas-artesanales.ts`) | La Fábrica Bar, Cervecería Shelter, Matute, Duna |
| Postres | Para darse un gusto (`para-darse-un-gusto.ts`) | Don Antonio Helados, Ventanin, Uno Catorce Café |

Son lugares publicados de Cordón, con textos cortos sacados de la descripción de la base. Para sacarlos, se borra la entrada en `GUIDES` (`catalog.ts`) y el archivo.

## Verificación

- **Tests (app):** `yarn test` da 103 archivos y 1716 tests OK. `tsc --noEmit` y `yarn lint` limpios. `yarn build` OK.
  - **404 sin guías:** `getNeighborhoodPage('pocitos')` da null sin consultar la base. También da null si ninguna guía tiene lugares publicados.
  - **Grupos vacíos ocultos:** un grupo sin guías no aparece, y tampoco uno cuya única guía no tiene publicados. Los grupos siguen el orden de la app, y la tarjeta trae los 3 logos y el conteo correcto.
  - **Borradores invisibles en producción:** en producción Cordón solo tiene Cafés y la consulta no pide los lugares de los borradores. Tampoco aparecen en `findGuide`, los params ni el sitemap. En desarrollo se ven los 4 grupos.
  - **Link del breadcrumb:** se renderiza `GuideHeader` y `NeighborhoodHeader` con `react-dom/server`. En la guía, "Cordón" es el único link y va a `/guides/montevideo/cordon`; en el barrio no hay links y Cordón lleva `aria-current="page"`.
  - JSON-LD del barrio: ItemList sin BreadcrumbList.
  - Textos del barrio con largos razonables.
  - El guard test ahora también recorre la ruta del barrio: no hay Google ni datos del pedido, está cacheada y no tiene mapa.
- **Producción servida** (`yarn build` + `yarn start`):
  - `/guides/montevideo/cordon` muestra un solo grupo (Cafés) y una tarjeta ("Cafés donde nadie te apura, 9 lugares"), con el título, la descripción, el canonical, `noindex` y el ItemList.
  - En la guía, el link de migas va a `/guides/montevideo/cordon`.
  - `/guias/...` da 404 real.
- **Lighthouse** (build de producción, `/guides/montevideo/cordon`):

  | | Performance | Accesibilidad | Buenas prácticas | SEO |
  |---|---|---|---|---|
  | Mobile | 97 (LCP 2,5 s, CLS 0) | 100 | 96 | 66 |
  | Desktop | 100 (LCP 0,5 s, CLS 0,008) | 100 | 96 | 66 |

  - **SEO 66:** se debe solo al `noindex` (ALLOW_INDEXING apagado).
  - **Buenas prácticas 96:** son los scripts de Vercel Analytics y Speed Insights, que en local dan 404.
  - **CLS de desktop 0,008:** viene del `<main>` del header. La ficha del lugar tiene el mismo corrimiento (0,012 en `/place/inocencio-cafe`), así que no es de esta página.
- **Capturas** (dev, con los borradores, en el scratchpad de la sesión):
  - Desktop 1440 px: `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans/511451fa-cdbb-452f-9892-8a604dc6487c/scratchpad/barrio-desktop.png`
  - Mobile 412 px, emulado por Lighthouse, página completa: `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans/511451fa-cdbb-452f-9892-8a604dc6487c/scratchpad/barrio-mobile.jpg`
  - Con una guía por grupo, el scroll horizontal de mobile no se nota. Para verlo hace falta un segundo borrador en el mismo grupo.
  - Las saqué contra el `next dev` que ya estaba corriendo en el puerto 3000. Solo lo leí.

## 3. Proxy: 404 real en /guides

- **Qué hace** (`src/proxy.ts`):
  - El matcher es solo `/guides/:path*`; en el build queda compilado como `^(/_next/data/…)?/guides(/…)?`. El resto de la app no pasa por el proxy.
  - Las rutas válidas salen de `guideRoutes()` en `server/guides/routes.ts`: la página de cada barrio con guías visibles y cada guía visible. Se arma **una vez por instancia y solo con el archivo**, sin consultar la base.
  - Si la ruta existe, sigue de largo (`NextResponse.next()`). Si no, se reescribe a la 404 de la app con **status 404** (`rewrite('/_not-found', { status: 404 })`).
  - Los borradores no entran en producción, así que dan 404; en `next dev` existen.
  - Para no cargar el catálogo de intenciones en el proxy, `groupLabel` pasó a `server/guides/groups.ts`.
- **Probado con `yarn build` + `yarn start`:**

  | Ruta | Antes | Ahora |
  |---|---|---|
  | `/guides/montevideo/cordon` | 200 | 200 |
  | `/guides/montevideo/cordon/cafes-donde-nadie-te-apura` | 200 | 200 |
  | `/guides/montevideo/pocitos` (barrio sin guías) | 200 + noindex (soft 404) | **404** |
  | `/guides/montevideo/cordon/cervezas-artesanales` (borrador) | 200 + noindex | **404** |
  | `/guides/montevideo/cordon/otra`, `/guides/montevideo` (las toman las rutas dinámicas) | 200 + noindex (soft 404) | **404** |
| `/guides` (sin página) | 404 | 404 |
  | `/guides/montevideo/pocitos` con header `RSC: 1` (navegación del cliente) | — | **404** |
  | `/place/inocencio-cafe`, `/search` | 200 | 200 (el proxy no corre) |

  - Con barra final (`/guides/montevideo/cordon/`), Next redirige con 308 antes de llegar al proxy. Igual, `isGuideRoute` la acepta.
- **Tests** (`server/guides/test/routes.test.ts`):
  - En producción, las rutas son exactamente el barrio y la guía publicada.
  - Los borradores son 404 en producción y existen en desarrollo.
  - Son 404: un barrio sin guías, un slug inexistente, `/guides`, `/guides/montevideo` y un tramo de más.
  - La barra final cuenta como la misma ruta; las mayúsculas, no.
- **Caso que no cubre:** una guía o un barrio que existe en el archivo pero se quedó sin lugares publicados. Ahí la ruta sigue siendo válida para el proxy y vuelve el soft 404 de la página (200 + noindex).

### Latencia

TTFB con `yarn start` local: 300 pedidos secuenciales por ruta, después de 20 de calentamiento. La primera medición es sin proxy y la segunda con proxy, sobre el mismo código.

| Ruta | Sin proxy (mediana / p95) | Con proxy (mediana / p95) |
|---|---|---|
| `/guides/montevideo/cordon` | 0,68 / 1,04 ms | 0,78 / 0,99 ms |
| `/guides/montevideo/cordon/cafes-donde-nadie-te-apura` | 0,74 / 1,13 ms | 0,80 / 1,10 ms |
| `/guides/montevideo/pocitos` | 1,16 / 1,77 ms (soft 404) | 0,61 / 0,96 ms (404) |
| `/place/inocencio-cafe` (fuera del matcher) | 2,04 / 2,84 ms | 2,03 / 2,66 ms |

- En las páginas que existen suma **~0,1 ms de mediana**, y el p95 no cambia.
- La 404 sale más rápido que antes, porque ya no renderiza la ruta dinámica.
- Lo que no está en el matcher no cambia.
- La comprobación en sí es un `Set.has` sobre 2 rutas.

**Ojo con Vercel (no medido acá):**
- El proxy corre como función antes de la cache. En producción, cada pedido a `/guides/...` dispara una invocación, también cuando la página sale del CDN. Eso incluye los prefetch de los links a guías.
- Eso suma el costo de la invocación y, en frío, el arranque de la función.
- Hoy son pocas rutas y poco tráfico. Igual conviene medir el TTFB en un preview antes de lanzar (curl o Speed Insights).
- Leer `DEPLOY.md` antes de deployar.

### Cómo extender el mismo proxy a /place sin consultar la base en cada pedido

La diferencia es que los slugs de las fichas cambian sin deploy (el backoffice publica y despublica), así que no alcanza con el archivo. Hace falta un set de slugs publicados que el proxy lea **en memoria** y que se actualice aparte de los pedidos:

1. **El set:**
   - Una lista de slugs publicados, un par de miles de strings y unas decenas de KB.
   - Se carga con la misma consulta del sitemap (`select slug from places where status = 'published'`) o desde un lugar compartido (ver 3).
   - Se guarda en memoria del proceso, con la fecha de carga.
2. **Nunca bloquear el pedido:**
   - Si el set está fresco (por ejemplo, menos de 60 s): slug en el set → `next()`; slug fuera del set → rewrite a la 404 con status 404.
   - Si el set está vencido: se usa igual y se recarga en segundo plano (`event.waitUntil`), una carga a la vez por instancia.
   - Si no hay set (instancia nueva): `next()`, es decir, el soft 404 de hoy, y se carga en segundo plano.
   - Así la base se consulta como mucho una vez por minuto por instancia, nunca en el camino del pedido.
3. **Un lugar recién publicado no tiene que dar 404** mientras el set de una instancia está viejo. Opciones, de más simple a más exacta:
   - **(a) Solo TTL corto:** un slug que no está en un set de más de unos segundos de antigüedad pasa con `next()` y fuerza la recarga. Solo se responde 404 si el set es reciente. Es lo más simple, pero el 404 real deja de ser inmediato para slugs nuevos.
   - **(b) Set compartido en Vercel Runtime Cache** (`getCache`, como la búsqueda):
     - Una clave `places:published-slugs` que el backoffice reescribe al publicar o despublicar, o que refresca el cron.
     - El proxy lee de memoria y, cuando vence, de la Runtime Cache. Nunca de Neon.
   - **(c) Edge Config:** la misma lista, escrita por el backoffice en cada cambio de publicación. El proxy la lee en sub-milisegundos sin ir a la base. Es lo más exacto (el cambio se ve al instante), pero suma una dependencia y un paso en el backoffice.
4. **Costo:**
   - En `/place` el tráfico de proxy es mucho más grande que en `/guides`. Pasa por el proxy cada link a una ficha que se precarga (las cards de la home, de /search y de los similares), no solo cada vista.
   - En Vercel, cada uno es una invocación de la función del proxy.
   - Para no pagarlo, conviene que el matcher excluya los prefetch, con `missing: [{ type: 'header', key: 'next-router-prefetch' }]`. Un prefetch de una ficha inexistente no hace daño.
   - Antes de decidir, conviene medirlo en un preview.
5. **Tests:** los mismos que `routes.test.ts`, más el comportamiento con set vencido o ausente (siempre `next()`, nunca 404) y que la consulta nunca corre en el camino del pedido.

## Pendientes / para decidir

- `/guides` y `/guides/montevideo`: cuando existan, se suman los links de las migas y el BreadcrumbList en las dos páginas. También van a la lista de rutas del proxy.
- Las portadas de las tarjetas: el espacio está listo (`cover`), falta el contenido.
- El soft 404 de la ficha (`/place`): queda para después (ver arriba).
