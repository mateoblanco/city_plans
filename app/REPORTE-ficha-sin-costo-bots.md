# Reporte: la ficha sin costo de Google para bots

Sin commits (esperan tu prueba). 20 archivos modificados y 19 nuevos, más este reporte.

Verificación: `yarn test` 89 archivos, 1645 tests OK · `tsc --noEmit` limpio · `yarn lint` limpio · `yarn build` OK.

---

## 1) El servidor sale sólo con datos nuestros

- `server/places/page-data.ts` no importa nada de Google:
  - se sacan la promesa `google` y el Place Details de cada sucursal (`branchAddress`);
  - `BRANCH_FIELD_MASK` deja de existir.
- `PlacePage.tsx` muestra en el HTML lo de la base: nombre, logo, descripción, tags, barrio, Instagram, descuentos y el estado "Abierto/Cerrado" de los horarios de la base (`placeOpenText(place.hours, null, now)`).
- **Dirección.** La base no la tiene (se borró en la migración 0016). Como acordamos, la calle llega desde el navegador, y el HTML muestra "Montevideo, Barrio" con la línea de la calle reservada.
- **Sucursales.** Van sin dirección: "Sucursal Cordón", y la card lleva a su ficha.
- **`google-cost-guard.test.ts` reescrito.** Recorre los imports de valor (también `import()` y re-exports) desde `app/place/[slug]/page.tsx`. Falla si algún módulo del render importa `server/places/google` o nombra `places.googleapis.com` / `fetchPlaceDetails`.
  - Lo probé agregando un `import { parseDetails } from './google'` en `page-data.ts`: el test falló con "server/places/page-data.ts importa ./google". Después lo saqué.
  - Además verifica que `fetchPlaceDetails` sólo se importe desde la ruta nueva y que el pedido a `/api/place-google` sólo salga de `loadPlaceGoogle`. `loadPlaceGoogle`, a su vez, sólo se llama dentro de un `useEffect` de un archivo `"use client"`.
  - Siguen los tests de los links: nada de `prefetch` y `OriginLink` sin props extra.

## 2) Lo de Google se pide desde el navegador

- **Ruta `GET /api/place-google/[id]`** (`app/api/place-google/[id]/route.ts`):
  - `id` es **nuestro uuid**, no el place_id de Google. Busca el `google_place_id` de un lugar publicado (`getPublishedGooglePlaceId` en `server/places/place.ts`), así nadie puede usar la ruta para consultar lugares ajenos.
  - Hace Place Details con el mismo `DETAILS_FIELD_MASK` y devuelve sólo `parseDetails`: rating, ratingCount, reviewsHref, openNow, address, week, website, whatsappHref. El teléfono sólo se usa para armar el WhatsApp.
  - Todas sus respuestas llevan `Cache-Control: no-store, private` y `X-Robots-Tag: noindex, nofollow`.
- **Cliente:**
  - `PlaceGoogle/PlaceGoogle.tsx` llama a la ruta una sola vez, en un `useEffect` y con la página visible (`whenVisible`, el de los eventos). La lógica está en `loadPlaceGoogle` (`PlaceGoogle/utils/load.ts`).
  - Una guarda (`useRef`) evita la segunda llamada del doble efecto de StrictMode. No hay reintentos.
  - El prefetch de Next no corre efectos, y el render del servidor tampoco.
  - Lo reparte por contexto a cuatro islas de cliente: `PlaceRating`, `GoogleStatus`, `PlaceAddress` y `PlaceInfo` (contacto + horarios).
- **Espacio reservado.** Mientras llega, cada parte ocupa su lugar:
  - el puntaje, un hueco invisible del ancho de "★ 4,6 (1.230) en Google ↗";
  - la línea de estado, alto fijo;
  - la calle, una línea reservada;
  - los horarios, la semana reservada invisible.
- **Estado** (`mergeStatus`):
  - sin estado de la base, sale el abierto/cerrado de Google;
  - si Google dice lo contrario que la base (abierto contra cerrado), gana Google, sin detalle;
  - si coinciden, queda el de la base con su detalle ("Cierra 00:00").
  - Como la línea tiene alto fijo, el cambio es sólo de texto.
- **Bundle.** Para que las islas no se lleven código del servidor, `DAY_NAMES` pasó a `src/lib/day-names.ts` (`server/search/labels.ts` lo reexporta). Los helpers del puntaje pasaron a `PlacePage/utils/rating.ts`, sin imports (`utils/summary.ts` los reexporta).

**Probado en Chrome (Playwright, build de producción, iPhone):**
- en la home, prefetch + hover sobre 5 links a fichas y scroll: **0** pedidos a la ruta;
- al abrir una ficha: **1** pedido, y el puntaje se ve;
- al volver a la home: sigue en **1**.

## 3) Bots

- `robots.txt` tiene `Disallow: /api/place-google/` en los dos modos de `ALLOW_INDEXING` (`robotsConfig`, con test). Hoy sale:
  ```
  User-Agent: *
  Disallow: /
  Disallow: /api/place-google/
  ```
- Con un bot conocido (`isBot` de los eventos: Googlebot, bingbot, `Chrome-Lighthouse`, facebookexternalhit, curl, sin user agent, `HeadlessChrome`…), la ruta responde **204 vacío** sin buscar el lugar ni llamar a Google.
  - Lo comprobé con curl como Googlebot contra el build: 204, `no-store` y `noindex`.
- También responde 204 si:
  - el pedido viene de otro sitio (`Sec-Fetch-Site` distinto de `same-origin`, como `/api/events`);
  - el id no es de un lugar publicado con `google_place_id`;
  - Google falla, también por pasar la cuota diaria (429).
- En todos esos casos, la ficha se muestra sin lo de Google y sin mensaje de error.

## 4) Límite por IP: no se implementó

La regla de rate limit del Vercel Firewall **tiene costo en Pro**: USD 0,80 por millón de pedidos permitidos en gru1 ([precios de gru1](https://vercel.com/docs/pricing/regional-pricing/gru1), [WAF Rate Limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)). Como pediste, quedan robots.txt, el filtro de bots y el tope diario en la consola de Google. Si Google responde 429 al pasar ese tope, la ruta responde vacía.

Si algún día la querés, la regla se configura en el dashboard (también se puede por la CLI `vercel firewall` o el SDK):
1. Proyecto → **Firewall** → **Configure** → **+ New Rule**.
2. If: **Request Path** · **Starts with** · `/api/place-google/`.
3. Then: **Rate Limit**, **Fixed Window**, ventana **60 s**, límite **30**, key **IP**, acción **Too Many Requests (429)**.
4. **Save Rule** → **Review Changes** → **Publish**.

La ventana máxima de Pro es de 10 minutos, así que con esta regla no hay un límite diario. Un 429 del firewall hace que `loadPlaceGoogle` termine en vacío: la ficha sale sin lo de Google y sin error.

## 5) El mapa: diagnóstico de la primera tanda (las propuestas se hicieron en la segunda, ver al final)

**El código hoy:**
- **Desktop (≥ 900 px):** `useDeferredMount` monta `MapView` (Maps JS) después de `load` + `requestIdleCallback`. Cada mapa creado se cobra como Dynamic Maps (~USD 0,007).
- **Mobile:** la imagen de Static Maps va en el HTML, en un `<picture>` con la URL firmada directa a `maps.googleapis.com/maps/api/staticmap`. Cada imagen bajada se cobra (~USD 0,002).

**Googlebot:**
- **Hoy no entra a ninguna ficha:** nuestro robots.txt es `Disallow: /`.
- Cuando se active `ALLOW_INDEXING`:
  - Googlebot renderiza con Chromium y, según el equipo de rendering de Google, simula los momentos de inactividad para que corra `requestIdleCallback` ([SEJ](https://searchenginejournal.com/googles-web-crawler-fakes-being-idle-to-render-javascript/522305)). Con Googlebot Desktop, el montaje diferido del mapa **se dispararía**.
  - Pero el robots.txt de `maps.googleapis.com` (lo bajé hoy) tiene para `User-agent: *` `Disallow: /maps/api/staticmap`, `Disallow: /maps/api/js/` y `Disallow` de los RPC internos de Maps JS. Sólo permite `/maps/api/js`, el loader.
  - El renderer de Google respeta el robots.txt de cada recurso. Entonces:
    - **Mobile (Googlebot Smartphone):** no debería bajar la imagen de Static Maps, así que no habría cobro.
    - **Desktop:** baja el loader, pero no los módulos ni los RPC de Maps JS. Lo más probable es que el mapa no llegue a crearse y no haya cobro de Dynamic Maps.
  - No lo puedo confirmar sin ver la facturación de Maps cruzada con el tráfico de Googlebot. Lo dejo como "probable", no como hecho.
- **El riesgo real son los bots que no respetan robots.txt:** scrapers con Chrome headless o Puppeteer, y algunos previsualizadores. Esos cargan la imagen en mobile y Maps JS en desktop, y pagan las dos cosas.

**Lo que propongo (para que lo decidas):**
1. No montar `MapView` si `isBot(navigator.userAgent)`. Es barato y corta los headless que se declaran como tales.
2. Montarlo además sólo cuando el recuadro entra en pantalla (IntersectionObserver). Así una ficha abierta sin scrollear en desktop chico no paga el mapa.
3. Con UA de bot, que el servidor renderice el recuadro liso (el color de tierra que ya usa `/search`) en vez del `<picture>` de Static Maps. `Details` ya es dinámico y puede leer `headers()`. No afecta el SEO: el mapa no es contenido indexable.

## Lighthouse mobile, antes y después

`/place/ramona` (1 sucursal), build de producción local contra la base real, Lighthouse 12.8.2 CLI, 3 corridas por caso. Va la mediana.

| | Performance | LCP | CLS | TBT | FCP |
|---|---|---|---|---|---|
| Antes | 89 | 3,70 s | 0 | 1 ms | 1,72 s |
| Después (UA por defecto de Lighthouse) | 89 | 3,63 s | 0,00014 | 2 ms | 1,71 s |
| Después (UA de Chrome mobile) | 91 | 3,37 s | 0,00014 | 0 ms | 1,71 s |

- **Corrección al plan:** el UA móvil de Lighthouse CLI **no** dice "Lighthouse" (es `… moto g power (2022) … Chrome/136 Mobile Safari/537.36`). Por eso las dos filas de "después" son la misma condición: en las 6 corridas la ruta respondió 200 y trajo los datos de Google.
  - PageSpeed Insights sí manda `Chrome-Lighthouse` y, con ese UA, la ruta responde vacía. Si medís con PSI, vas a ver la ficha sin lo de Google.
- **Las diferencias de Performance y LCP son ruido entre corridas** (87–92 en las 9). El LCP es la imagen del mapa en las dos versiones.
- **CLS 0,00014 después:** es el h1 y Lighthouse lo atribuye a "Web font loaded" (dos woff2 de Fontshare), no a la llegada de Google. La llegada de los datos de Google no produjo ningún shift.
- **Desktop (1440 px), medido con PerformanceObserver:** los shifts son idénticos con la ruta en 204 y en 200.
  - Hay un 0,011 a los ~100 ms: el `<main>` baja 17 px (de y=56 a y=73), empujado por el header. Pasa igual sin Google y este cambio no toca el header; no lo comparé contra el código anterior.
  - Hay otro de 0,0000002 en un SVG.

## Cuánto costó medir

Precios de lista de Google:

| Qué | Cantidad | Precio | Subtotal |
|---|---|---|---|
| Place Details Enterprise (3 de "antes", 6 de "después", 1 de la prueba del flujo, 1 de la de CLS en desktop) | 11 | ~USD 0,02 | ~USD 0,22 |
| Place Details Essentials (la sucursal, en las 3 de "antes") | 3 | ~USD 0,005 | ~USD 0,015 |
| Static Maps (las 9 de Lighthouse y la prueba del flujo) | 10 | ~USD 0,002 | ~USD 0,02 |
| Dynamic Maps (las 4 cargas de desktop) | 4 | ~USD 0,007 | ~USD 0,03 |
| **Total** | | | **~USD 0,28** |

Con la cuota gratis mensual de cada SKU, si no está agotada, lo más probable es que se facturen USD 0. Las pruebas con UA de bot (curl como Googlebot y las corridas con `HeadlessChrome`) no llamaron a Places.

## Qué probar vos

1. Abrir una ficha desde la home: en DevTools → Network, un solo `/api/place-google/<id>` con `cache-control: no-store, private`.
2. Hover y scroll sobre cards de la home: ningún pedido a esa ruta.
3. Una ficha sin `google_place_id`: ningún pedido y nada reservado.
4. Con un UA de bot (DevTools → Network conditions → Googlebot): la ruta responde 204 y la ficha sale sin puntaje, sin calle y sin horarios de Google, sin errores.
5. Una ficha con sucursales: las cards dicen sólo "Sucursal <Barrio>".

## Archivos

- **Nuevos:**
  - `app/api/place-google/[id]/route.ts` y su test;
  - `PlacePage/PlaceGoogle/` (`PlaceGoogle.tsx`, `utils/load.ts`, `utils/context.ts`, `utils/status.ts`, tests);
  - `PlaceInfo/`;
  - `PlaceSummary/PlaceRating/`, `PlaceSummary/GoogleStatus/` y `PlaceSummary/PlaceStatus/`;
  - `PlaceLocation/PlaceAddress/`;
  - `PlacePage/utils/rating.ts`;
  - `src/lib/day-names.ts`.
- **Modificados:**
  - `PlacePage.tsx`, `PlaceSummary`, `PlaceLocation`, `PlaceBranches` / `BranchCard`, `PlaceHours` (import de `DAY_NAMES`);
  - `utils/summary.ts`;
  - `server/places/{page-data,place,google}.ts`;
  - `server/search/labels.ts`;
  - `server/seo/indexing.ts` y los tests;
  - `AGENTS.md` (las dos viñetas de la ficha y la de sucursales).

---

# Segunda tanda: el mapa

Sin commits. Verificación: `yarn test` 90 archivos, 1653 tests OK · `tsc --noEmit` limpio · `yarn lint` limpio · `yarn build` OK.

## Con user agent de bot: recuadro liso

- `PlacePage.tsx` (`Details`) lee el user agent con `headers()` y usa `isBot`, el mismo de los eventos.
- Con un bot:
  - `PlaceMap` recibe `plain`: dibuja el recuadro liso (`--color-map-placeholder`, con el borde del mapa), sin `StaticMap` (la imagen no está en el HTML) y sin montar Maps JS.
  - **Agregado**: a un bot tampoco se le monta el pedido a `/api/place-google` (`inGoogle = !!google_place_id && !bot`). La ruta igual lo cortaba con un 204; ahora ni siquiera hay pedido, y la ficha no reserva huecos que después quedarían vacíos.
- **Probado** (Playwright, build de producción, `/place/ramona`) como Googlebot Smartphone (412 px), Googlebot Desktop (1440 px) y HeadlessChrome (1440 px), con scroll hasta abajo:
  - recuadro liso: 1;
  - `<picture>`: 0;
  - pedidos a `maps.googleapis.com`, `gstatic` o a la ruta: **ninguno**.
- **Ojo con PageSpeed Insights:** manda `Chrome-Lighthouse`, así que ve el recuadro liso y la ficha sin lo de Google. Con ese UA el LCP pasa a ser la descripción.

## Desktop: el mapa interactivo se monta al entrar en pantalla

- `PlaceMap/utils/deferred-mount.ts` (`scheduleMount`, lógica pura con tests) monta el mapa cuando se cumplen las tres cosas a la vez:
  - desktop (≥ 900 px);
  - la página ya cargó (`load`);
  - el recuadro está en pantalla (IntersectionObserver).
- Recién ahí espera a que el navegador quede libre (`requestIdleCallback`) y monta una sola vez. Si falta alguna, sigue esperando: hasta que se scrollee al mapa o se agrande la ventana.
- `use-deferred-mount.ts` conecta eso con el navegador; con `plain` no hace nada.
- **Mobile no cambia:** la imagen de Static Maps sigue en el HTML. Es el LCP de la ficha en mobile y no la hice diferida.
- **Probado en desktop** (1440×420, para que el mapa quede abajo, con el recuadro en y=684):
  - antes de scrollear: **0** pedidos a Maps;
  - al scrollear hasta el mapa: se monta y carga Maps JS;
  - **ningún layout shift** al montarlo: el mapa llena el recuadro, que ya tenía su tamaño final.
  - El único shift de la página es el de siempre a los ~150 ms (el `<main>` baja 17 px por el header), igual con y sin Google, y no tiene que ver con el mapa.

## Tests nuevos

- `PlaceMap/utils/test/deferred-mount.test.ts`:
  - fuera de pantalla no monta; al entrar, una sola vez y con el navegador libre;
  - espera el `load`;
  - en mobile nunca, y al agrandar la ventana con el recuadro visible, sí;
  - la limpieza cancela lo pendiente.
- `google-cost-guard.test.ts`, en un grupo nuevo:
  - el servidor calcula `bot` con `isBot(headers user-agent)`;
  - `<PlaceMap plain={bot}>`;
  - `<StaticMap>` sólo dentro de `{!bot && …}`;
  - `PlaceGoogle enabled={inGoogle}`, con `inGoogle` sin bot;
  - `MapView` sólo se renderiza desde `PlaceMap`, con `ready` de `useDeferredMount(ref, "ml", !props.plain)`, que usa IntersectionObserver.

## Lighthouse mobile (`/place/ramona`, 3 corridas, mediana)

| | Performance | LCP | CLS | TBT | FCP |
|---|---|---|---|---|---|
| Antes de todo | 89 | 3,70 s | 0 | 1 ms | 1,72 s |
| Después de la 1.ª tanda | 89 | 3,63 s | 0,00014 | 2 ms | 1,71 s |
| Después de la 2.ª tanda | 87 | 3,94 s | 0,00014 | 0 ms | 1,72 s |
| Con UA de bot (`Chrome-Lighthouse`, 1 corrida) | 92 | 3,19 s | 0 | 3 ms | 1,72 s |

- Las corridas van de 87 a 92 en todas las tandas: la diferencia entre medianas es ruido.
- En mobile este cambio no toca lo que se carga: la imagen sigue igual y Maps JS nunca se montaba en mobile. El LCP sigue siendo el recuadro del mapa.
- El 0,00014 es el mismo de la fuente web en el h1.

## Cuánto costó medir esta tanda

| Qué | Cantidad | Subtotal (lista) |
|---|---|---|
| Place Details Enterprise (3 de Lighthouse y 1 de la prueba de desktop) | 4 | ~USD 0,08 |
| Static Maps (Lighthouse) | 3 | ~USD 0,006 |
| Dynamic Maps (la prueba de desktop, al scrollear) | 1 | ~USD 0,007 |
| **Total** | | **~USD 0,09** |

Las pruebas con UA de bot (las dos pasadas de Playwright y la corrida de Lighthouse con `Chrome-Lighthouse`) no costaron nada.

## Qué probar vos

1. Desktop con la ventana baja: en Network, ningún `maps.googleapis.com` hasta scrollear al mapa; al llegar, se monta sin mover nada.
2. DevTools → Network conditions → UA de Googlebot: el mapa es un recuadro liso y no hay pedidos a Google ni a `/api/place-google`.
3. Mobile con un navegador normal: la imagen de Static Maps sigue igual.
