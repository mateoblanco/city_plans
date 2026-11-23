# Reporte: diagnóstico de rendimiento en mobile

Sin cambios de código ni commits (`git status` limpio). Sólo se escribió este archivo.

## Cómo se midió

- **Build de producción local** (`yarn build` + `yarn start`, Next 16.3.8 con Turbopack) contra la base y las claves de `.env.local`. `TRACK_EVENTS` está apagado en local: las corridas no guardaron eventos de popularidad.
- **Lighthouse 12.8.2 mobile** (Moto G Power emulado, 4× CPU, 4G lento simulado con Lantern, que es lo mismo que usa PageSpeed). **3 corridas por página; se informa la mediana.**
- Páginas: `/`, `/search`, `/search?q=café en Cordón` y `/place/escaramuza`. Elegí esa ficha por ser de las más prominentes y **no tener sucursales** (sólo paga el Place Details del lugar).
- **Corridas complementarias, gratis salvo una:**
  - Una corrida con throttling aplicado por Puppeteer (4× CPU, 150 ms RTT, 1,6 Mbps), para ver la línea de tiempo real: qué aparece cuándo, el elemento del LCP en cada momento, el arranque del mapa y los tiles. Lantern estima tiempos; esta corrida los observa.
  - Un build con `--profile --no-mangling` para las fases de hidratación de React y la cuenta de componentes. Después se volvió a dejar el build normal.
  - `next experimental-analyze --output` (el bundle analyzer de Turbopack) para saber de qué viene cada chunk.
- Scripts y resultados crudos (JSON de Lighthouse, traces): `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans/f67c9746-446e-4d61-b5f2-3968b63899ad/scratchpad/runs/`.

### Costo de Google de este diagnóstico

| Qué | Cantidad | Precio de lista | Total |
|---|---|---|---|
| Place Details Enterprise (ficha `escaramuza`, sin sucursales) | **4 cargas** (3 de Lighthouse + 1 de línea de tiempo) | ~USD 0,02 | **~USD 0,08** |
| Dynamic Maps (cada carga que crea un mapa: /search y la ficha en mobile) | ~20 cargas | ~USD 0,007 | ~USD 0,14 |
| Modelo y embedding de "café en Cordón" | 1 (después, de la caché) | despreciable | < USD 0,001 |

Con la cuota gratis mensual de cada SKU, lo más probable es que la factura real sea USD 0. No lo puedo verificar desde acá. Ninguna corrida de la ficha se repitió: las del perfilado de React fueron sólo de la home y /search.

---

## Resumen

| Página | LCP (mediana LH) | Elemento del LCP | FCP | TBT | CLS | Perf |
|---|---|---|---|---|---|---|
| Home | **3,4 s** | primera foto de Platos (`DishCard`, hamburguesa) | 1,7 s | 1 ms | 0 | 90 |
| /search | **9,1 s** | vista previa estática de Google Maps (`StaticMapService.GetMapImage`, 412×719) | 2,0 s | 37 ms | 0 | 69 |
| /search?q=café en Cordón | **8,6 s** | la misma vista previa del mapa | 1,7 s | 18 ms | 0 | 72 |
| Ficha | **6,4 s** | vista previa estática del mapa de la ficha (328×204) | 1,7 s | 27 ms | 0 | 74 |

**Lo principal:** en /search y en la ficha el LCP **no es el contenido sino la imagen de vista previa que pone Maps JS** antes del mapa vectorial. Esa imagen tarda porque Maps JS recién empieza a bajar **después de la hidratación**, y la hidratación tarda porque antes hay que bajar 200–340 KB gzip de JS. La lista y la descripción de la ficha se ven mucho antes:

| Página (throttling aplicado) | Primer contenido real | Candidato a LCP antes del mapa | La vista previa del mapa (= LCP) |
|---|---|---|---|
| /search?q | cards a los **0,54 s** (vienen en el HTML) | título del panel, 2,96 s (al remontar la lista en el Drawer) | **5,5 s** |
| /search | cards a los 0,55 s | texto, 0,55 s | **6,4 s** |
| Ficha | descripción a los **1,44 s** (cuando llega el stream de `Details`) | — | **4,6 s** |
| Home | foto de Platos a los **0,54 s** = LCP | — | (sin mapa) |

El TBT es bajo en todas: el problema es de **cadena de carga**, no de hilo principal bloqueado. El CLS es ~0 en todas.

---

## Home (referencia)

### 1. LCP

- **Elemento:** `li > a.DishCard…card > span.DishCard…frame > img.DishCard…image`, la foto de Hamburguesas (`/_next/image?url=…burger…webp&w=256`). Lleva `fetchpriority="high"`, `loading="eager"`, está en el HTML inicial y no es lazy. Está bien resuelta.
- **Desglose (corrida mediana, Lantern):** TTFB 453 ms · demora de carga 97 ms · carga 297 ms · **demora de render 2.588 ms (75 %)**.
- **Esa demora de render es en buena parte un artefacto de Lantern:** cuenta como dependencias del LCP los 13 chunks de JS (301 KB gz) que arrancan antes de que la imagen pinte. Con throttling aplicado, la imagen pinta junto con el FCP, a los **0,54 s**. Igual es una señal útil: menos JS al arranque baja también este número (ver causa 3).

### 2. Render y hilo principal

- Render bloqueado por **3 CSS propios** (8,6 + 3,1 + 2,5 KB, ~450 ms simulados) y por **2 hojas de estilo de terceros** (`api.fontshare.com`, ver Fuentes).
- Hilo principal: 1,2 s en total (evaluación de scripts 461 ms, "other" 429 ms, estilo y layout 103 ms). Una sola tarea larga, de 51 ms. TBT 1 ms.
- **Hidratación:** arranca a los ~3,35 s con throttling aplicado (espera la bajada del JS) y dura ~260 ms de CPU a 4×. El chunk de React/Next (`1zzimqy…`) suma 327 ms de scripting simulado. Ver abajo qué componentes la causan.
- HTML de **503 KB sin comprimir** (39 KB gzip): **246 KB son SVG inline repetidos**: el ícono de descuento (3,4 KB × 53) y el corazón (1 KB × 62). Más 115 KB de payload RSC. El parseo inicial es una tarea de ~335 ms a 4× CPU.

### 3. JS (gzip)

**372 KB** en total: **301 KB referenciados en el HTML** y 71 KB después. De esos 71, 51 KB son el prefetch de las rutas de `/search` y `/place` que hace `<Link>` a los 150 ms, y 8,5 KB son la bienvenida, después del `load`, como corresponde.

| Chunk | KB gz | Qué es | ¿Hace falta para lo primero que se ve? |
|---|---|---|---|
| `1zzimqy…` | 72 | react-dom + runtime de Next | sí |
| `0p6etcpy…` | **50** | **motion** (motion-dom + framer-motion): sólo lo usa `Search.tsx` para el placeholder que rota | **no** |
| `3-my9koo…` | 45 | Base UI core + floating-ui (popups, posicionamiento) | **no** (sólo al abrir un filtro, popover o tooltip) |
| `17j-8040…` | 44 | router de Next (app-router, RSC client) | sí |
| `36s_olao…` | 37 | PlaceCard, SaveButton, CardDiscounts, LocationSelect, Select, Popover (Base UI) | las cards sí; Select y Popover no |
| `0sps43y7…` | 24 | ResultsView, ResultsSheet, MapColumn, ZoneButton… (de `/search`) | **no**: es prefetch, 100 % sin usar en la home |
| resto | ~100 | Button y Tooltip, HeaderBack, RowScroller, BankChip, Speed Insights… | parcial |

Lighthouse calcula 97 KB de JS sin usar en la carga.

### 4. Imágenes

- **Platos** (`src/assets/food`, originales de 1254×1254): pasan por `next/image` (AVIF o WebP), se piden con `w=256` y se muestran a 88×88 CSS (154 px a DPR 1,75). Bien. Las 2 primeras van eager+high, 2 eager y el resto lazy. Correcto.
- **Logos de R2:** `PlaceImage` usa **`unoptimized`**. Se bajan los WebP de **256×256 para mostrarlos a 64×64** (hacen falta ~112 px a DPR 1,75): ~4× los píxeles. Hay 46 pedidos, **266 KB**, casi todos lazy y posteriores al LCP. Lighthouse estima 139 KB de ahorro. Los 2 primeros van eager+high y el resto lazy. Correcto.

### 5. Fuentes

Ver la sección general. En la home: Switzer 400/500/600 + Plein 700, **4 woff2, ~79 KB**.

### 7. CLS

0,0001. Se mueven en cantidades ínfimas los logos de la primera fila (al cargar), el botón "Descuentos" y un botón de la barra (al hidratar o al cambiar la fuente).

---

## /search (con y sin texto)

### 1. LCP

- **Elemento (las 6 corridas):** `div > div > img` con `src="https://maps.googleapis.com/maps/api/js/StaticMapService.GetMapImage?…"` de 412×719. Es la **vista previa raster que pone Maps JS** antes de dibujar el mapa vectorial. Ya estaba anotado en AGENTS.md como decisión ("/search es noindex: se prioriza ver el mapa antes").
- **Desglose (corrida mediana, Lantern):**

| | TTFB | Demora de carga | Carga | Demora de render | LCP |
|---|---|---|---|---|---|
| /search | 452 ms | **4.114 ms** | **4.397 ms** | 99 ms | 9,06 s |
| /search?q | 452 ms | **2.848 ms** | **5.171 ms** | 152 ms | 8,62 s |

La demora de carga es la cadena **HTML → chunks de JS → hidratación → `useEffect` de `MapSync` → `maps/api/js` → `main.js` → `map.js` → pedido de la vista previa**. El "tiempo de carga" es la imagen misma (72 KB PNG) compitiendo con el resto de Maps (1,1 MB). Lighthouse marca que la imagen no se descubre en el HTML y no tiene `fetchpriority`. Las dos cosas son de Google: no son nuestras.

Con throttling aplicado (`/search?q`), los tiempos observados fueron:

| Momento | Tiempo |
|---|---|
| Cards en el DOM y pintadas (FCP) | 0,53–0,54 s |
| Hidratación | 2,85 s |
| Lista pasada al Drawer | 2,94 s |
| `maps/api/js` pedido | **2,80 s** |
| `main.js` | 3,0–4,35 s |
| `map.js` | 4,4–5,1 s |
| Vista previa pintada (LCP) | **5,5 s** |
| `webgl.js` | 5,4–6,5 s |
| Canvas vectorial | 6,5 s |

- **/search sin texto es peor** porque el documento es de **656 KB sin comprimir (84 KB gzip), y 412 KB son payload RSC con los 455 resultados** (`SearchResult` completos: `reasons`, `openStatus`, `branches`, `discounts`…), aunque sólo se dibujan 42 cards. Con throttling, el HTML termina de llegar a los **2,5 s** (con texto, a los 0,57 s), y eso corre la hidratación y el mapa (vista previa a los 6,4 s en lugar de 5,5 s).

### 2. Render y hilo principal

- Render: los mismos 3 CSS propios y las 2 hojas de Fontshare. No hay JS que bloquee el render (todo es `async`).
- Hilo principal: 2,0 s (sin texto) y 1,9 s (con texto). El más pesado es **`webgl.js` de Maps, con 470–580 ms de scripting simulado y 3 tareas largas de 50–90 ms**; después, React/Next con 345–437 ms. TBT 18–37 ms.
- **Hidratación (build de perfilado, throttling aplicado):** empieza a los 2,85 s (con texto) o 3,1 s (sin texto) y son **~285–305 ms de CPU a 4×**, en tramos (`Hydrated` 16 ms, `Prepared` 35 + 28 + 61 ms…). Después vienen el **remontaje de la lista en el Drawer** (`Cascading Update` → `Render` 28 ms + `Render` 21 ms + `Commit` 18 ms, ~70 ms) y, a los 4,5–4,6 s, los efectos del mapa (otros ~50–70 ms).
- **Qué componentes la causan** (fibers de React después de hidratar; el costo de hidratar es casi todo reconciliación interna de React, así que el tamaño del árbol es la mejor medida):

| /search?q (1.681 fibers) | /search (2.518 fibers) |
|---|---|
| `DrawerContent` con la lista: **1.026** (incluye las 26 cards) | `DrawerContent` con la lista: **1.725** (42 cards) |
| `SearchMap` con 27 `PlaceMarker`: 280 (después del LCP) | `SearchMap` con 43 `PlaceMarker`: 440 |
| `TooltipRoot` de Base UI: **26 en las cards + 27 en los marcadores** (~10 fibers cada uno) | 42 + 43 |
| 44 `LinkComponent`, 33 `Button`, 3 `SelectRoot` (FilterBar), `PopoverRoot` | 59 `LinkComponent`, 51 `Button`, 3 `SelectRoot` |

Por script, en la ventana de hidratación: React ~110–125 ms, runtime de Turbopack (instanciar módulos) ~45–65 ms, chunk de Results/ResultsSheet ~40–50 ms, Base UI core ~29 ms y PlaceCard/Select ~11 ms.

### 3. JS (gzip)

**388 KB** en total: **340 KB en el HTML** y 48 KB después (SearchMap con `@vis.gl/react-google-maps`, 31,6 KB, y el prefetch de la ficha, 13 KB). **Maps JS de Google son otros 1,16 MB**: `labeler_wrapper.wasm` 650 KB, `styleTables` 228 KB, `webgl.js` 182 KB, `main.js` 87 KB, `util.js` 73 KB…

| Chunk | KB gz | Qué es | ¿Hace falta al principio? |
|---|---|---|---|
| `1zzimqy…` | 72 | react-dom + Next | sí |
| `0p6etcpy…` | **50** | **motion** (placeholder del buscador) | **no**: en /search ni siquiera rota |
| `3-my9koo…` | 45 | Base UI core / floating-ui | **no** hasta abrir un popup |
| `17j-8040…` | 44 | router de Next | sí |
| `36s_olao…` | 37 | PlaceCard, SaveButton, Select, Popover, LocationSelect | parcial |
| `42xa2ij6…` | 32 | `@vis.gl/react-google-maps` + MapMarker + **~20 KB de `blurDataURL` de los 40 íconos de `shared/icons`** (el import estático los genera y `MarkerIcon` sólo usa `.src`) | después; los ~20 KB de blur **nunca** se usan |
| `0sps43y7…` | 24 | ResultsView, ResultsSheet, MapColumn, ZoneButton, SelectedPlace… | sí (Drawer en mobile) |
| `3q8iyc94…` + `26ui…` | 9 + 8 | Drawer y Dialog de Base UI | Drawer sí, Dialog no |
| `2ngkbv40…` (en analyzer) | — | incluye **`shared/tags.ts`, 7 KB gz** (para HeaderSearch) | parcial |

Base UI suma ~120 KB gz entre todos sus chunks: Select, Popover, Tooltip, Field, Drawer, Dialog y floating-ui. Para lo primero que se ve sólo hace falta el Drawer.

### 4. Imágenes

- Logos de R2: lo mismo que en la home (256 px para 64 px, `unoptimized`). Hay 20 pedidos, 89–126 KB. Las 4 primeras cards van eager (2 con high). Correcto.
- **Íconos de los marcadores** (`shared/icons/*.webp`): `<img>` sin `next/image`, **de 90×90 mostrados a 20×20** (35 px a DPR 1,75), **de 7 a 12 KB cada uno, 16 distintos y 144 KB en /search**. AGENTS.md lo eligió así a propósito (3× los 30 px del marcador activo), pero a 20 px en reposo y con DPR menor que 3 sobra. Bajan después del LCP, pero compiten con Maps JS.
- Vista previa del mapa: PNG de 72 KB. Es de Google: no se puede tocar.

### 6. Mapa

- **Cuándo se inicializa:** el `useEffect(startMapsLoad)` de `MapSync` corre al hidratar, así que `maps/api/js` se pide recién a los ~2,8 s con throttling aplicado (a los 0,14 s sin throttling). El `preconnect` a `maps.googleapis.com` y `maps.gstatic.com` sale con la hidratación: no está en el HTML. `<Map>` aparece a los ~5,1 s (`.gm-style` con la vista previa) y el canvas vectorial a los ~6,5 s.
- **Peso:** Maps JS ~1,16 MB transferidos por carga (mapa vectorial: wasm del etiquetador, tablas de estilo y WebGL), más `@vis.gl/react-google-maps`, 31,6 KB gz, y la fuente Roboto que trae Google (37,5 KB).
- **Tiles antes del LCP:** son **12 tiles vectoriales de z14 (~80 KB)** en `/maps/vt`. Con throttling aplicado arrancan *después* de `webgl.js`, o sea **después del LCP (0 antes)**: el LCP lo pone la vista previa, no los tiles. En la corrida sin throttling, los 12 se pidieron antes de que terminara la vista previa. En ningún caso aportan al LCP.
- **¿El mapa o el Drawer retrasan la lista?** **El primer pintado, no:** las cards vienen en el HTML del servidor y se ven en el FCP (0,54 s), antes de cualquier JS del mapa. Pero:
  1. **El mapa sí retrasa el LCP *medido***: una imagen más grande que pinta 5 s después pasa a ser el LCP, aunque la lista ya se viera.
  2. **El Drawer remonta la lista entera al hidratar** (pendiente conocido de AGENTS.md): ~70 ms de CPU a 4×, todos los nodos de las cards se vuelven a crear a los ~2,9 s y el título del panel pasa a ser candidato a LCP en ese momento.
  3. En /search sin texto, la lista **sí** se retrasa por su propio payload: los 455 resultados hacen que el HTML llegue a los 2,5 s.

### 7. CLS

0,0001 (con texto) y 0,00003 (sin texto). Se mueve la fila de chips de filtros ("Para trabajar", "Al aire libre", "Abierto ahora") al hidratar, y el botón "Descuentos". Es despreciable.

---

## Ficha (`/place/escaramuza`)

### 1. LCP

- **Elemento (las 3 corridas):** `div > div > img`, la **vista previa estática de Maps JS en `PlaceMap`** (328×204, 9 KB).
- **Desglose (corrida mediana, Lantern):** TTFB 452 ms · **demora de carga 5.530 ms (87 %)** · carga 207 ms · demora de render 188 ms. LCP 6,4 s (las 3 corridas: 5,8, 6,4 y 7,2 s).
- **Por qué el mapa entra:** en mobile, `use-deferred-mount` monta el mapa cuando está a 200 px de la pantalla. En esta ficha (descripción corta, sin descuentos ni sucursales) el mapa ya está en el primer viewport de 412×823, así que se monta apenas hidrata (`maps/api/js` a los 2,48 s con throttling aplicado), y su vista previa (66.912 px²) le gana al párrafo de la descripción (45.592 px²).
- **El LCP de contenido**, `P.PlaceSummary…description` ("Librería-café y espacio cultural…"), llega a los **1,44 s** con throttling aplicado, y no antes porque **todo `Details` espera a `getPlacePage`**: la fila de la base y, en un mismo `Promise.all`, Place Details de Google, los parecidos (consulta por embedding) y los descuentos. El documento terminó de llegar a los 0,41, 1,15 y 1,33 s en las 3 corridas: la variación es la latencia de Google y de los parecidos. **La descripción y el logo son de la base**, pero esperan a Google.

### 2. Render y hilo principal

- Los mismos CSS y Fontshare que bloquean el render.
- Hilo principal: 1,5 s. **`webgl.js` de Maps con 364 ms de scripting** y tareas de 58 y 71 ms. `main.js` de Maps con una de 55 ms. React/Next con 185 ms. TBT 27 ms.
- Hidratación: la más chica de las cuatro (425 elementos de DOM; Header, SaveButton y PlaceActions, HoursToggle, PlaceMap, Tooltip). Para no pagar otra carga de Place Details no la perfilé con el build de perfilado. El chunk de React suma 185 ms simulados.

### 3. JS (gzip)

**235 KB**: 202 KB en el HTML y 33 KB después (`@vis.gl/react-google-maps` + PlaceMap, a los ~0,7 s sin throttling). No carga motion. Sí carga Base UI core (45 KB, para Tooltip y Popover), que no hace falta para lo primero que se ve. Maps JS: los mismos ~1,16 MB.

### 4. Imágenes

- **No hay fotos de Google en la ficha.** `DETAILS_FIELD_MASK` es `rating, regularOpeningHours, shortFormattedAddress, websiteUri, internationalPhoneNumber` (sin `photos`), así que se bajan **0 bytes de fotos de Google**. Las únicas imágenes de Google son la vista previa del mapa (9 KB) y sus tiles (12 tiles, 7,6 KB).
- Logo del lugar: R2, 256×256 mostrado a 68×68, eager+high. Correcto, pero se pide recién a los **1,16 s** porque está dentro del `Suspense` de `Details` y llega con el stream.
- Logos de los parecidos: 256×256 mostrados a 44×44, lazy. Igual se bajan al cargar (Chrome pide las lazy cercanas al viewport).
- Ícono del marcador: 90×90 mostrado a 30×30.

### 7. CLS

0,00014: el título "Escaramuza" a los ~2,07 s, probablemente por el cambio a Plein 700. Es despreciable.

---

## Fuentes (todas las páginas)

| | |
|---|---|
| Familias propias | **Switzer** 400/500/600 y **Plein** 500/600/700, desde Fontshare |
| Cómo se cargan | 2 `<link rel="stylesheet">` a **`api.fontshare.com`** en el `<head>` del layout: **bloquean el render**. Son hojas de terceros (otra conexión DNS+TLS), y de ahí salen los woff2 a **`cdn.fontshare.com`, que no tiene `preconnect`** (sólo lo tiene `api.`) |
| Usadas | home y ficha: Switzer 400/500/600 + Plein 700 (4 woff2, **~79 KB**); /search: Switzer 400/500/600 (3 woff2, ~59 KB) |
| `font-display` | `swap` (va en la URL): no hay texto invisible |
| De Google | Maps trae Roboto 400/500 (37,5 KB) y Google Sans en /search y la ficha: después del LCP |
| Tiempo | con throttling aplicado, las 2 CSS de Fontshare van de 0,17 a 0,42 s, pegadas al FCP (0,50–0,55 s). Lighthouse no las cuenta en su auditoría de bloqueo, pero en una red real son un salto extra de conexión antes del primer pintado |

---

## CLS (todas)

Mediana de CLS **0** en las 4 páginas (valores observados entre 0,00003 y 0,00014). No hay nada que arreglar: el espaciador del header fijo y el recuadro reservado del mapa de la ficha funcionan.

---

## Speed Insights

**Está activo en el código:** `@vercel/speed-insights` 2.1 y `<SpeedInsights />` en `app/layout.tsx`. En local responde 404 (`/_vercel/speed-insights/script.js` sólo existe en Vercel; es el único error de consola de las 4 páginas y es esperable).

**No pude leer los datos reales:** no hay CLI de Vercel ni token en este entorno. Para mirarlos: Vercel → proyecto → **Speed Insights** → filtrar **Mobile** → P75 de LCP por ruta (`/search`, `/place/[slug]`, `/`). Conviene confirmar ahí que la recolección esté prendida en el proyecto: el componente solo no alcanza si Speed Insights no está habilitado en el dashboard o el plan.

Lo que yo esperaría ver ahí (a confirmar): un P75 de LCP de /search y de la ficha cerca del tiempo de la vista previa del mapa (varios segundos), y una home mucho mejor de lo que dice Lighthouse.

---

## Causas ordenadas por impacto estimado en el LCP (mobile)

Las estimaciones son sobre el LCP de Lighthouse (y, entre paréntesis, sobre el throttling aplicado). No se implementó nada.

| # | Causa | Páginas | Arreglo propuesto | Mejora estimada del LCP | Riesgo y costo (Google incluido) |
|---|---|---|---|---|---|
| 1 | **La vista previa de Maps JS es el elemento del LCP** y pinta tarde porque Maps empieza a bajar después de la hidratación | Ficha | En mobile el mapa es quieto (`gestureHandling: none`): **reemplazar Maps JS por una imagen de Static Maps** (`maps/api/staticmap` con `map_id`, el marcador como ícono PNG público y el tamaño exacto), renderizada en el servidor dentro de `Details` y eager. Variante sin cambiar de API: no montar Maps JS en mobile hasta un toque ("Ver mapa") y mostrar el recuadro liso | **6,4 s → ~2,5–3 s** (4,6 → ~1,5 s). Además saca ~1,2 MB y ~0,5 s de CPU de Maps | Static Maps cuesta ~USD 0,002 por carga contra ~USD 0,007 de Dynamic Maps: **más barato**. La atribución va dentro de la imagen. El marcador tiene que ser una imagen pública (no un componente). Choca con "nunca una imagen de Google" de AGENTS.md, que se escribió para /search: decidirlo para la ficha |
| 1b | Lo mismo | /search | (a) **Pedir Maps JS desde el HTML** (`<script async>` o `<link rel="preload">` de `maps/api/js` y `preconnect` en el `<head>` de /search) en lugar del `useEffect` de `MapSync`. (b) O aceptarlo: es la decisión actual porque /search es noindex | (a) **8,6–9,1 s → ~6–6,5 s** (5,5 → ~3,5 s) | Mismo costo de Google. Maps (los primeros ~250 KB) compite con el JS propio: la hidratación se corre ~0,3–0,5 s. Hay que revisar que `APIProvider` siga reusando la carga. El LCP de campo de /search quedará siempre atado al mapa mientras la vista previa sea la imagen más grande |
| 2 | **La ficha espera a Google para mostrar lo que es de la base** (`Promise.all` con Place Details, parecidos y descuentos) | Ficha | Partir `Details`: header, logo, descripción y resumen con la fila de la base (sale enseguida). Horarios, rating, contacto y "Abierto" de Google en su propio `Suspense`, y los parecidos en otro | Con el arreglo 1: el LCP de texto o logo, **−0,2 a −0,9 s** (lo que tarde Google). Sin el 1 no cambia el número, porque el mapa sigue siendo el LCP | **Sin costo extra de Google** (los mismos pedidos). `google-cost-guard.test.ts` tiene que seguir pasando: Google queda dentro de un `Suspense`. "Abierto/Cerrado" aparecería con las horas de la base y se corregiría con Google: reservar el lugar para no sumar CLS |
| 3 | **Mucho JS al arranque que no hace falta para lo primero que se ve:** la hidratación (y con ella el mapa) espera a bajar 300–340 KB gz | Las 4 (más /search) | (a) **Sacar motion** (50 KB gz) y hacer la rotación del placeholder con CSS (`@keyframes` + `prefers-reduced-motion`). (b) Cargar los popups de Base UI (Select, Popover, Tooltip, Field: ~60–80 KB) al primer foco, hover o toque del filtro. (c) Importar los íconos de los marcadores como URL y no como imagen estática (saca ~20 KB gz de `blurDataURL` del chunk del mapa) | Hidratación −0,5 a −0,8 s con throttling, y el mapa de /search arranca ese tiempo antes: **/search −0,5 a −0,8 s**. Home en Lighthouse ~3,4 → ~2,5 s (Lantern cuenta ese JS). Ficha ~−0,3 s | (a) es bajo riesgo. (b) es medio: foco, teclado y a11y de los popups hay que probarlos, y el primer toque tiene que cargar sin un retraso visible (precargar al hover o al foco). Sin costo de Google |
| 4 | **/search sin texto manda los 455 resultados en el payload RSC** (412 KB sin comprimir) y dibuja 42 | /search | Mandar la primera página (y, si el mapa necesita todos los puntos, sólo `{id, lat, lng, iconCategory}` del resto). "Ver más" por `/api/search` | /search sin texto: el HTML termina ~2 s antes con throttling; **LCP −0,5 a −1 s** | Medio: la paginación de `ResultsView`, `stableMapPlaces` y el `fitKey` dependen de tener todo. Un pedido más al tocar "Ver más" (sin modelo ni Google: es la misma búsqueda, cacheada) |
| 5 | **Maps vectorial: ~1,16 MB y ~0,5 s de CPU** (wasm 650 KB, estilos 228 KB, `webgl.js` 182 KB) que compiten con el resto | /search, ficha | Probar `renderingType: RASTER` con el mismo Map ID (los estilos de la nube y `AdvancedMarker` funcionan en raster) | Poco en el LCP (la vista previa va antes de WebGL): ~−0,1 a −0,3 s por menos competencia. **Mucho en datos y en TBT/INP** | Bajo o medio: cambia algo cómo se ve (etiquetas, inclinación) y hay que revisar el estilo del Map ID. Sin cambio de costo (sigue siendo Dynamic Maps) |
| 6 | **Fuentes desde un tercero, que bloquean el render**, y `cdn.fontshare.com` sin `preconnect` | Las 4 | Servirlas desde el proyecto con `next/font/local` (woff2 de Switzer y Plein, `display: swap`, preload de los pesos de arriba). Mínimo: `preconnect` a `cdn.fontshare.com` | FCP y LCP de texto **−0,1 a −0,3 s** en 4G real. Ficha con el arreglo 1, lo mismo | Bajo. Verificar que la licencia de Fontshare (ITF Free Font License) permita servirlas desde el proyecto. Sin costo de Google |
| 7 | **HTML inflado por SVG inline repetidos** (home: 246 KB de 503; el ícono de descuento de 3,4 KB × 53) | Home, /search | Un sprite (`<symbol>` + `<use href>`) o `mask-image` en CSS para `discount.svg` y `heart.svg` | −50 a −150 ms de parseo a 4× CPU; poco en el LCP de la home (la foto es lo primero) | Bajo. Sin costo de Google |
| 8 | **Hidratación de árboles grandes:** un `Tooltip` de Base UI por card y por marcador (62 en la home, 26 + 27 en /search?q, ~10 fibers cada uno) y **el remontaje de la lista en el Drawer** en mobile | /search, home | Un solo tooltip compartido (o `title` / CSS) para "Guardar" y para los marcadores. Para el Drawer, las opciones ya evaluadas en AGENTS.md (panel propio sin portal) | Hidratación −15 a −25 % (~50–100 ms a 4×) y, sin el remontaje, otros ~70 ms. En el LCP de /search, ~−0,1 s (el mapa arranca después de hidratar) | El tooltip es bajo o medio (a11y: el nombre accesible del botón tiene que quedar). El Drawer es alto (reimplementar el gesto). Sin costo de Google |
| 9 | **Imágenes más grandes que lo mostrado:** logos 256 px para 64 px (`unoptimized`); íconos de marcador 90 px para 20 px (7–12 KB cada uno) | Las 4 | Logos: una variante de 128 px desde el backoffice, o sacar `unoptimized` (ya está el `remotePattern` de R2). Íconos: exportarlos a 60 px (2× del activo) o revisar la compresión de los 90 px (7–12 KB es mucho para 90×90) | Casi nada en el LCP (son lazy o posteriores). Menos datos: home −~140 KB en logos, /search −~70–110 KB en íconos. Menos competencia con el mapa | Bajo. Los íconos a 60 px se ven un poco menos nítidos en pantallas 3× (hoy es una decisión de AGENTS.md). Sacar `unoptimized` suma transformaciones de Vercel Image Optimization (costo de Vercel, no de Google). La variante del backoffice no tiene costo por pedido |
| 10 | Prefetch de las rutas de `/search` y `/place` durante la carga de la home (51 + 13 KB, prioridad baja) | Home | Nada urgente. Si molestara, `prefetch` al hover en las filas de abajo | Despreciable | No tocar el prefetch de las fichas sin revisar `google-cost-guard` (hoy no paga Google) |

> **Estado posterior (noviembre 2026):** la causa 3 (a) ya se hizo en la tanda de rendimiento 1 (`REPORTE-rendimiento-tanda-1.md`, sección 3): `motion` salió del proyecto. Hoy la home sólo carga `motion/mini` (el `animate` de `FilterReveal`, el plegado de los filtros), que no es el paquete completo. Medida otra vez con esta misma configuración, la home mobile da 91–92 y LCP de 3,29 s (`REPORTE-guias-entradas-mobile.md`, sección Lighthouse).

**Orden sugerido para empezar:** 1 en la ficha (indexable, y es la mejora más grande y además más barata en Google) + 2. Después 3a (motion: es chico y seguro) y 1b(a). Después 4. El resto es limpieza de bytes.
