# Reporte: SEO y AEO, parte 1 (listo para prender la indexación)

Sin commits (esperan tu prueba). `ALLOW_INDEXING` no se tocó en Vercel.

**Verificación:** `yarn test` 112 archivos y 1775 tests OK. `tsc --noEmit` y `yarn lint` limpios. `yarn build` OK.

No toqué `search-href.ts`, `labels.ts` ni `PlaceCard.module.scss`. Trabajé encima de tus cambios sin commitear. `src/lib/site.ts` ya estaba sin trackear: lo reescribí y conservé `SITE_NAME` y `withSiteName`.

---

## 1) Nombre y dominio

- `src/lib/site.ts` define tres constantes:
  - `SITE_NAME = "A Dónde Vamos"`;
  - `SITE_ALTERNATE_NAME = "adondevamos"`;
  - `SITE_URL = "https://www.adondevamos.com.uy"`. Es una constante, ya no una variable de entorno.
- Toda URL absoluta sale de `SITE_URL`: `metadataBase` (canonical y Open Graph), robots, sitemap, el JSON-LD de la ficha, las guías, la ciudad, el barrio y la home.
- Se borró `siteUrl()`, que leía `SITE_URL` y `VERCEL_PROJECT_PRODUCTION_URL`. También se sacó `SITE_URL` de `.env.example`.
- Ya no queda `city-plans.vercel.app` en `src/`, `.env.example` ni `DEPLOY.md`. Sólo aparece en `AGENTS.md`, donde se explica que redirige.
- **Efecto lateral, a favor:** el PNG del marcador de Static Maps ahora sale de `SITE_URL` también en local. Antes no salía porque Google no llega a localhost. En los previews sigue saliendo del propio deploy.
- **Interruptor:** `allowIndexing()` exige `ALLOW_INDEXING=true` **y** `VERCEL_ENV=production`. En previews, `next dev` y local nunca se indexa:
  - Lo probé con un build con `VERCEL_ENV=preview ALLOW_INDEXING=true`.
  - Resultado: robots con `Disallow: /`, sitemap con 0 URLs y `noindex, nofollow` en home, guía y ficha.
  - Para probarlo prendido en local: `VERCEL_ENV=production ALLOW_INDEXING=true yarn build && VERCEL_ENV=production ALLOW_INDEXING=true yarn start`.
  - Las variables van **en los dos comandos**: las páginas dinámicas (ficha, /search) arman la metadata en cada pedido.
  - Revisé que `VERCEL_ENV` no cambia nada más: sólo lo lee `markerIconBase`, y sólo mira `preview`.
- **Redirects 308:** se configuran en el dashboard, no en el código. Los pasos están en "Pasos manuales".

## 2) robots.txt

Con la indexación prendida (salida real del build):

```
User-Agent: *
User-Agent: OAI-SearchBot
User-Agent: ChatGPT-User
User-Agent: GPTBot
User-Agent: Claude-SearchBot
User-Agent: Claude-User
User-Agent: ClaudeBot
User-Agent: PerplexityBot
User-Agent: Google-Extended
Allow: /
Disallow: /api/
Disallow: /guide-preview/
Disallow: /search

Sitemap: https://www.adondevamos.com.uy/sitemap.xml
```

- Todos los bots van en **un solo grupo**. En robots.txt, un grupo con nombre reemplaza al de `*` para ese bot. Con grupos separados, cada bot tendría que repetir los `Disallow`. La lista está en `NAMED_CRAWLERS` (`server/seo/indexing.ts`).
- `/api/` incluye `/api/place-google/`.
- Con la indexación apagada queda como hoy: `Disallow: /` y `Disallow: /api/place-google/`.
- **Para que lo sepas:** con `Disallow: /search`, Google no puede leer el `noindex` de /search. Si alguna URL de /search recibe muchos links, puede figurar en Search Console como "indexada, aunque bloqueada por robots.txt", sin contenido. Lo dejé como pediste. La alternativa es sacar `/search` del Disallow y confiar en el `noindex, follow`.

## 3) Sitemap

- Con la indexación prendida tiene 783 URLs:
  - la home;
  - `/guides/montevideo`;
  - 3 guías publicadas;
  - 778 fichas.
- Hoy ningún barrio llega al mínimo de 3 guías, así que no hay páginas de barrio. Cuando haya, entran solas.
- Comparación con la base (consulta de sólo lectura): hay 778 lugares, todos `published`, y el sitemap trae 778 `/place/`.
  - Hoy no hay borradores, en revisión ni ocultos para mostrar que quedan afuera. Lo cubren los tests:
    - la consulta exige `status = 'published'`;
    - `guideSitemapPages` descarta las guías en borrador y las que no tienen lugares publicados.
- **lastmod real:**
  - fichas: `places.updated_at`, que ninguna tiene en null;
  - guías: `guides.content_updated_at`, por día (así viene de la base);
  - home: la fecha más nueva entre fichas y guías.
- Para tener en cuenta: `updated_at` cambia con cualquier escritura en la fila, no sólo con cambios de contenido (un refresco de señales, por ejemplo). Es la "fecha de última modificación en la base" que pediste. Si el backoffice reescribe muchas filas a la vez, el lastmod del sitemap salta para todas.

## 4) 404 real en la ficha

**Cómo funciona.** `src/proxy.ts` suma el matcher `/place/:slug`:
- **Slug inválido** (no cumple `[a-z0-9-]`, mayúsculas, `%ZZ`): 404 sin mirar nada.
- **Slug válido:** se busca en la lista de slugs publicados (`server/places/slugs-cache.ts`). Usa el mismo `createSwrCache` que la home y las rutas de guías:
  - memoria de la instancia → Runtime Cache de Vercel → base;
  - la lista dura un minuto;
  - **nunca hay una consulta por pedido**.
- **Slug que no está en la lista:** rewrite a `/_not-found` con `status: 404`.
- **La base falla y no hay lista:** deja pasar, y queda el `notFound()` de la página (200 + noindex, como hoy).

**Probado contra el build:**

| URL | Status |
|---|---|
| `/place/no-existe-xyz` | 404 |
| `/place/Ramona` | 404 |
| `/place/%ZZ` | 404 |
| `/place/ramona` | 200 |
| `/place/1921-restaurant` | 200 |
| `/guides/montevideo/no-existe` | 404 (sigue igual) |

**Latencia.** Build de producción, servidor caliente, 3 corridas de 20 pedidos, mediana. TTFB de la ficha, que manda el shell primero:

| | `/place/ramona` | `/place/1921-restaurant` |
|---|---|---|
| Sin `/place` en el proxy | 2,33 ms | 2,63 ms |
| Con proxy | 2,67 ms | 2,61 ms |
| 404 de un slug inexistente | 0,81 ms | |

- La diferencia es ruido: va de 0 a 0,3 ms.
- **Un cambio respecto del plan:** primero lo armé como las guías, que rearman la lista vencida antes de responder (`blockOnStale`). Medido así, **un pedido por minuto y por instancia esperaba ~180 ms** (172, 184 y 181 ms en 3 pruebas, por la consulta a Neon desde acá).
  - Lo cambié a stale-while-revalidate: con la lista vencida responde con la vieja y la rearma en segundo plano (`event.waitUntil`).
  - Con lista vencida ahora da 10, 9 y 6 ms.
- Sólo espera el **primer pedido de una instancia nueva**: ~0,2 s en local (204, 217 y 207 ms), que incluye la primera consulta. En Vercel, una instancia nueva lee primero la Runtime Cache.
- **Contra:** publicar una ficha tarda hasta un minuto (más el pedido que dispara el rearmado) en dejar de dar 404. Despublicar tarda lo mismo en empezar a dar 404; mientras tanto, la página da su soft 404 de siempre.

## 5) Datos estructurados (JSON-LD), sin nada de Google

### Ficha (`PlacePage/utils/structured-data.ts`)

| Campo | De dónde sale |
|---|---|
| `@type` | La primera categoría:<br>• `restaurant`, `grill`, `pizzeria`, `chiviteria`, `bodegon` → `Restaurant`<br>• `cafe` → `CafeOrCoffeeShop`<br>• `bar`, `brewery`, `wine_bar` → `BarOrPub`<br>• **nuevos:** `bakery` → `Bakery` (30 fichas) e `ice_cream_shop` → `IceCreamShop` (28), antes `LocalBusiness`<br>• el resto → `LocalBusiness` (hoy ninguna) |
| `name` | `places.name` |
| `description` | `places.description_es` (espacios normalizados) |
| `url` | `SITE_URL` + `/place/<slug>` |
| `address` | `PostalAddress` con sólo `addressLocality: "Montevideo"` y `addressCountry: "UY"`. Sin calle. |
| `containedInPlace` | el barrio (`neighborhood_id` → `neighborhoodDisplayName`), "Centro, Montevideo" |
| `servesCuisine` | los tags de `places.tags` que son `CUISINES`, en español; sólo en los tipos de comida |
| `priceRange` | `places.price` → `$` / `$$` / `$$$` |
| `openingHoursSpecification` | `places.hours` (**nuevo**). Ver detalle abajo. |
| `logo`, `image` | el logo de R2 (`LOGO_BASE_URL` + `places.logo_key`) |
| `sameAs` | **nuevo:**<br>• `places.instagram` → `https://www.instagram.com/<usuario>/`<br>• `places.website` → URL absoluta |

**Horarios (`openingHoursSpecification`):**
- Salen de `places.hours` **sólo con `status: exact`**: 666 de 778 fichas (377 de fuente oficial y 289 de terceros, nunca de Google).
- Con `partial` faltan días o cierres ("martes a viernes desde las 19") y se leerían como cerrados.
- Los turnos sin hora de cierre no van.
- Los turnos con el mismo horario se juntan en una entrada, con los días desde el lunes.
- Si cierra después de medianoche, el cierre queda antes que la apertura, como pide Google.

**De dónde sale la web.** `places.website` es la web propia que elige el pipeline con fuentes propias. La de Google (`websiteUri`) sólo la confirma: "no es fuente", dice el backoffice. Está en 389 fichas. El Instagram está en 747.

**Lo que no va:** puntaje, reseñas, teléfono, calle, coordenadas ni nada de Place Details. El test tiene una lista cerrada de claves y rechaza `rating`, `review`, `telephone`, `geo`, `streetAddress` y `postalCode`.

Ejemplo real (`/place/ramona`, sin horarios porque no son `exact`): `CafeOrCoffeeShop`, nombre, descripción, URL del dominio, logo, `$$`, Montevideo/UY, "Centro, Montevideo" y `sameAs` con `instagram.com/caferamona_uy/` y `caferamona.com.uy`.

### Home (`HomePage/utils/structured-data.ts`)

- Un `@graph` con dos nodos unidos por `@id`:
  - `WebSite`: `name` "A Dónde Vamos", `alternateName` "adondevamos", `url` `https://www.adondevamos.com.uy/`, `inLanguage` es-UY y `publisher`;
  - `Organization`: `name`, `url` y `logo` `https://www.adondevamos.com.uy/android-chrome-512x512.png`.
- Sin `SearchAction`, porque Google ya no muestra la caja de búsqueda del sitio.

### Validación contra la documentación de Google (Search Central)

- **Local business** (ficha): aplica, pero sin resultado enriquecido propio.
  - Google exige `name` y `address`, y no exige `streetAddress` por separado: con sólo la localidad el marcado es válido.
  - Sin calle ni `geo`, igual es muy difícil que Google lo use para algo visible. Sirve para describir la entidad, a Google y a los LLMs.
  - `openingHoursSpecification`, `priceRange`, `servesCuisine` y `url` son "recomendados".
  - `logo` y `sameAs` vienen de Organization (LocalBusiness es un subtipo) y son válidos.
  - "Usá el subtipo más específico": la página nombra Restaurant como ejemplo. No nombra CafeOrCoffeeShop, BarOrPub, Bakery ni IceCreamShop, pero son subtipos de schema.org y el principio aplica.
  - La página no dice nada sobre marcar un negocio desde un directorio que no es el del negocio.
- **Site names (WebSite):** aplica. Exige `name` y `url` (la home canónica del dominio) y recomienda `alternateName`, que va. Tiene que estar en la home, y está ahí. El Rich Results Test no lo valida: hay que usar el Schema Markup Validator.
- **Organization:** aplica. No tiene campos obligatorios. El logo tiene que ser de al menos 112×112, rastreable y verse bien sobre blanco. Es de 512×512, pero conviene que lo mires sobre blanco.
- **Breadcrumb** (guías, ya existía): aplica. El último ítem puede ir sin `item`.
- **Carrusel (ItemList)** de la guía, la ciudad y el barrio: **no aplica**.
  - El carrusel de restaurantes está "limitado a un grupo chico de proveedores" que se anotan por un formulario de Google.
  - Además exige `Restaurant` con `image` en cada ítem.
  - El `ItemList` que ya está queda como dato para entender la página, sin resultado enriquecido.

## 6) Metadata

- **Ficha** (`PlacePage/utils/metadata.ts`):
  - Título real: `Ramona · Café en Centro, Montevideo · A Dónde Vamos`.
  - Sin categoría, el título dice `"<nombre> · En <barrio>, Montevideo"`.
  - La descripción es `description_es` cortada en una palabra, hasta 155 caracteres y con "…".
  - Sin descripción: "Ramona: café en Centro, Montevideo.".
  - Open Graph y Twitter usan el mismo título, sin el nombre del sitio.
- **Layout:** `<html lang="es-UY">` y un Open Graph base (`og:locale es_UY` y `og:site_name` "A Dónde Vamos") para las páginas que no definen el suyo. Las que lo definen ya tenían los dos.
- **Canonical absoluto** en la home, `/guides/montevideo`, las guías, los barrios y las fichas. /search no lleva: es noindex.
- **Hallazgo y cambio extra en `next.config.ts` (`htmlLimitedBots`):**
  - En una página dinámica (la ficha), Next manda la metadata por streaming: al navegador le llega al final del `<body>`. Al `<head>` sólo llega para los bots de su lista, que no incluye a GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot ni Claude-SearchBot.
  - Esos bots no ejecutan JS, así que recibían título, descripción y canonical fuera del `<head>`.
  - Agregué a la lista de Next los de `NAMED_CRAWLERS` más Googlebot. Next ya trata a Googlebot así a propósito porque renderiza JS, pero en el `<head>` no dependemos de eso.
  - Probado con curl: GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot, Claude-SearchBot y Googlebot reciben la `description` en el `<head>`. Un Chrome normal sigue por streaming.
  - Para la gente no cambia nada. Para estos bots, la ficha espera la consulta antes del primer byte: TTFB de ~48 ms contra ~2,8 ms.

## 7) Verificación

### Lighthouse SEO

Build de producción con el flag prendido, servidor caliente, 3 corridas por página, Lighthouse 12.8.2.

| Página | Con el UA de PageSpeed Insights (`Chrome-Lighthouse`) | Con el UA por defecto de Lighthouse CLI |
|---|---|---|
| `/` | 100 · 100 · 100 | 100 · 100 · 100 |
| `/guides/montevideo/primera-cita` | 100 · 100 · 100 | 100 · 100 · 100 |
| `/place/ramona` | 100 · 100 · 100 | **92 · 92 · 92** |
| `/place/1921-restaurant` | 100 · 100 · 100 | — |

- **Por qué la ficha da 92 con el UA por defecto:** ese UA es un Chrome de celular, que no está en ninguna lista de bots. Le llega la metadata por streaming en el `<body>`, y el audit `meta-description` sólo mira el `<head>`.
  - Es lo mismo que ve un navegador. PageSpeed Insights, Googlebot y los LLMs la reciben en el `<head>`.
- **Si querés 100 también con ese UA**, hay que desactivar el streaming de metadata para todos (`htmlLimitedBots: /.*/`).
  - Medido: el TTFB de la ficha para la gente pasa de ~2,8 ms a ~48 ms (3×20 pedidos, mediana: 2,81 contra 48,7 ms en Ramona y 2,70 contra 47,8 ms en 1921).
  - No lo hice: es una decisión de rendimiento tuya.

### robots.txt y sitemap

Correctos, ver los puntos 2 y 3.

### Bots sin costo

Playwright contra el build, con scroll hasta abajo, en `/place/ramona` y `/guides/montevideo/primera-cita`:

| Bot | Pedidos a `maps.googleapis.com`, `gstatic` o `/api/place-google/` | `<picture>` de Static Maps |
|---|---|---|
| Googlebot Smartphone (412 px) | 0 | 0 |
| Googlebot Desktop (1440 px) | 0 | 0 |
| GPTBot | 0 | 0 |

- Control: un Chrome mobile normal en la ficha **sí** intenta 2 pedidos (la ruta y el mapa), así que el 0 de arriba mide algo.
  - En el control aborté esos pedidos desde el navegador: no llegaron ni a nuestro servidor ni a Google. No hubo costo.
- La ficha decide en el servidor con `isBot` del user agent, y la guía con `useCanMap`. No los cambié.

### Tests nuevos o cambiados

- `server/seo/test/indexing.test.ts`:
  - el flag combinado con `VERCEL_ENV` (production, preview, development, vacío, sin definir);
  - robots apagado, prendido y en preview;
  - la lista de bots y los `Disallow`;
  - el dominio exacto en las URLs absolutas;
  - el lastmod de la home;
  - que la consulta del sitemap exija `published`.
- `server/places/test/slugs-cache.test.ts`:
  - 404 para un slug inexistente, no publicado o inválido;
  - pasa una ficha publicada;
  - sin lista, deja pasar;
  - una sola consulta para muchos pedidos;
  - con la lista vencida, responde con la vieja y la rearma en segundo plano;
  - lectura de la Runtime Cache, y un valor roto se descarta.
- `PlacePage/utils/test/structured-data.test.ts`:
  - cada tipo, con `Bakery` e `IceCreamShop`;
  - horarios: `exact`, `partial`, `vague`, sin cierre, día inválido, después de medianoche y agrupados;
  - `sameAs`;
  - la lista cerrada de claves.
- `PlacePage/utils/test/metadata.test.ts`: el título y la descripción, con y sin categoría, barrio o descripción.
- `HomePage/utils/test/structured-data.test.ts`: `WebSite` y `Organization` con el dominio.
- `server/places/test/static-map.test.ts`: el marcador sale de `SITE_URL`.

## Pasos manuales antes de prender

1. **Dominio en Vercel** (proyecto → **Settings** → **Domains**):
   1. **Add Existing** → `www.adondevamos.com.uy`. Agregá también `adondevamos.com.uy`: Vercel ofrece sumar el par www/apex.
   2. DNS en el proveedor del `.com.uy`:
      - `www`: **CNAME** al valor que muestra Vercel en Domains (con el punto final);
      - apex `@`: **A** al valor que muestra Vercel. Suele ser `76.76.21.21` o, en proyectos nuevos, `216.198.79.1`; usá el que te muestre. Borrá otros A/AAAA del apex.
      - Verificá con `dig A adondevamos.com.uy +short`, `dig CNAME www.adondevamos.com.uy +short` y `curl -IL https://adondevamos.com.uy`.
   3. En `adondevamos.com.uy` → **Edit** → **Redirect to** `www.adondevamos.com.uy`, y elegí **308** (Permanent).
   4. En `city-plans.vercel.app` → **Edit** → **Redirect to** `www.adondevamos.com.uy`, **308**.
      - **Ojo:** la doc de Vercel que leí no cubre redirigir el dominio `*.vercel.app` ni las opciones de status code. Que yo sepa, el modal de Edit de ese dominio tiene la opción, pero no lo pude confirmar en la doc.
      - Si no la tiene, se puede hacer en código: un `redirects()` en `next.config.ts` con `has: [{ type: "host", value: "city-plans.vercel.app" }]` y `permanent: true` (308). Los previews tienen otro host y no se afectan. Avisame y lo hago.
   5. Confirmá con `curl -sI https://adondevamos.com.uy/place/ramona` y `curl -sI https://city-plans.vercel.app/place/ramona`: tienen que dar `308` y `location: https://www.adondevamos.com.uy/place/ramona`.
2. **Clave de Google Maps:** sumá `https://www.adondevamos.com.uy/*` a los referrers permitidos de `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` en la consola de Google Cloud. Si no, el mapa de /search, el de desktop de la ficha y Static Maps fallan en el dominio nuevo.
3. **Marcadores de Static Maps:** ahora se piden a `https://www.adondevamos.com.uy/map-markers/…`. Hasta que el dominio sirva el sitio, la imagen de mobile sale sin marcador, también en producción. Por eso, primero el dominio y después el deploy de estos cambios.
4. **Variables en Vercel:** `ALLOW_INDEXING=true` **sólo en Production**. Aunque se cargara en Preview, el código no lo deja valer ahí. Después, **un deploy nuevo**: robots y sitemap se arman en el build. Ya no hace falta `SITE_URL`; si está cargada en Vercel, se puede borrar.
5. **Después del deploy:**
   - Revisá `https://www.adondevamos.com.uy/robots.txt` y `/sitemap.xml`.
   - Verificá que una ficha no tenga `<meta name="robots" content="noindex…">`.
   - Verificá que `/place/no-existe` dé 404.
6. **Google Search Console:** agregá la propiedad de dominio `adondevamos.com.uy` (verificación por DNS TXT) y enviá `https://www.adondevamos.com.uy/sitemap.xml`. Probá una ficha con **Inspección de URLs** → "Probar URL publicada".
7. **Bing Webmaster Tools:** podés importar desde Search Console y enviar el mismo sitemap. Bing alimenta a ChatGPT Search y Copilot.
8. **Validación:**
   - [Rich Results Test](https://search.google.com/test/rich-results) con una ficha;
   - [Schema Markup Validator](https://validator.schema.org) con la home, para `WebSite`.
9. **Logo de Organization:** mirá cómo se ve `android-chrome-512x512.png` sobre fondo blanco, como pide Google.
10. **`DEPLOY.md`:** ya no menciona el dominio viejo. Si querés, sumá estos pasos al checklist del lanzamiento. No lo toqué porque tiene cambios tuyos sin commitear.

## Archivos

- **Nuevos:**
  - `src/server/places/slugs-cache.ts` y su test;
  - `src/components/pages/PlacePage/utils/metadata.ts` y su test;
  - `src/components/pages/HomePage/utils/structured-data.ts` y su test;
  - este reporte.
- **Modificados:**
  - `src/lib/site.ts`, `src/server/seo/indexing.ts` (y su test), `src/app/robots.ts`, `src/app/sitemap.ts`, `src/app/layout.tsx`, `src/app/place/[slug]/page.tsx`, `src/proxy.ts`;
  - `src/server/places/place.ts` (`website` en `PlaceRow`), `src/server/places/static-map.ts` (y su test);
  - `PlacePage/utils/structured-data.ts` (y su test), `PlacePage.tsx`, `GuidePage.tsx`, `GuidesCityPage.tsx`, `GuideNeighborhoodPage.tsx`, `HomePage.tsx`;
  - `next.config.ts` (`htmlLimitedBots`), `.env.example`, `AGENTS.md`.
