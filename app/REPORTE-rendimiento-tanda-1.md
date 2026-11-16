# Reporte: rendimiento en mobile, tanda 1

Sin commits: queda todo en el árbol de trabajo para que lo pruebes. Los tres SVG que se movieron (`src/assets/{heart,heart_fill,discount}.svg` → `public/icons/`) figuran como borrados y no agregados: no hay nada en el stage.

## Resumen

| Página | | Perf | FCP | **LCP** | TBT | CLS | Elemento del LCP |
|---|---|---|---|---|---|---|---|
| Home | antes | 90 | 1,71 s | 3,43 s | 1 ms | 0 | foto de Platos (hamburguesa) |
| | después | 90 | 1,72 s | **3,21 s** | 0 ms | 0 | la misma |
| /search | antes | 69 | 2,01 s | 9,06 s | 37 ms | 0 | vista previa de Maps JS |
| | después | 69 | 2,01 s | 8,82 s | 47 ms | 0 | la misma |
| Ficha (`escaramuza`) | antes | 74 | 1,72 s | **6,38 s** | 27 ms | 0 | vista previa de Maps JS |
| | después (**sin la imagen estática**, ver abajo) | **93** | 1,72 s | **3,07 s** | **0 ms** | 0 | la descripción |

Lighthouse 12.8.2 en mobile (Moto G Power emulado, Lantern), mediana de 3 corridas con el build de producción (`yarn build` + `yarn start`). Las corridas de **antes** son las del diagnóstico (16/11, 01:32–01:34 UTC, con `HEAD` en a6e057a y el árbol limpio, o sea el mismo código de partida): no las volví a correr, y por eso no se pagó de nuevo Place Details. Los JSON crudos están en `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans/f0a1bdf6-0fc1-4af0-a248-bd675c531120/scratchpad/` (`before/`, `after/`, `exp-nopre/`).

**Ojo con la ficha:** la medí sin la imagen de Static Maps. Elegiste medir sin el secreto de firma, así que en mobile el recuadro del mapa queda liso. Con la imagen, lo esperable es que ella pase a ser el LCP (330×206 contra el párrafo): va eager, con prioridad alta y llega en el mismo pedazo del HTML que la descripción, así que debería quedar cerca de esos 3,1 s, no en los 6,4 s de antes. No está medido.

**Preconnect a `cdn.fontshare.com`: probado y sacado.** Con esa línea, la home daba Perf 88, FCP 2,48 s y LCP 3,44 s (mediana de 3, `after/home-*.json`). La FCP **observada** era la misma (~110 ms), así que el empeoramiento lo pone la simulación de Lantern, que cuenta la conexión anticipada en el camino del primer pintado. Sin ella (la fila "después", `exp-nopre/home-*.json`, un build igual al de ahora en lo que toca a la home), FCP 1,72 s y LCP 3,21 s. Las fuentes quedaron como antes de la tanda: los mismos `<link>` a `api.fontshare.com`, con su preconnect.

### Peso por página (HTML y JS del primer pedido)

| Página | HTML transferido | HTML sin comprimir | JS propio (gz) | JS total (incl. Google) |
|---|---|---|---|---|
| Home | 37,9 → **31,5 KB** | 503 → **271 KB** | 372,5 → **320,6 KB** | igual que el propio |
| /search | 81,9 → **78,0 KB** | 641 → **515 KB** | 388,5 → **343,4 KB** | 856,7 → 811,5 KB |
| Ficha | 22,2 → 22,1 KB | 93,9 → 98,0 KB | 235,6 → **202,0 KB** | 703,5 → **202,0 KB** |

- Home y /search: los ~232 KB y ~126 KB menos de HTML son los corazones (×62 en la home) y el ícono de descuento (×53), que eran `<svg>` inline. Los ~45–52 KB menos de JS son motion.
- Ficha en mobile: ya no se baja nada de Maps JS (antes eran ~470 KB de Google, más el chunk de `@vis.gl`, 33 KB). Con el secreto de firma, las 13 URLs firmadas suman **~6,3 KB sin comprimir, ~0,4 KB gzip**. Aparecen dos veces (HTML y payload de RSC), pero se comprimen bien.

## Costo de Google de esta tanda

| Qué | Cantidad | Precio de lista | Total |
|---|---|---|---|
| Place Details Enterprise (`escaramuza`, sin sucursales) | **4** (3 de Lighthouse + 1 de desktop) | ~USD 0,02 | **~USD 0,08** |
| Dynamic Maps (cargas que crean un mapa) | ~11: 3 de Lighthouse de /search, 4 de desktop de verificación, 4 de mobile **antes de arreglar un bug mío** (abajo) | ~USD 0,007 | ~USD 0,08 |
| Static Maps | 0 cobrables: los ~8 pedidos de prueba llevaban un secreto de mentira y Google los rechaza (403) | ~USD 0,002 | ~USD 0 |
| Modelo y embeddings | 0 (home y /search vacía no los usan) | — | 0 |

En total, unos **USD 0,16** de lista, que con la cuota gratis mensual seguramente quedan en 0. No lo puedo ver desde acá. Para calibrar y verificar sin pagar, corrí el server con `GOOGLE_PLACES_API_KEY` vacía: la ficha sale sin las partes de Google y sin llamar a Places.

---

## 1. Ficha en mobile: Static Maps

**Qué hace.** Debajo de `ml` (900px, como acordamos: es donde la ficha pasa a una columna), `PlaceMap/StaticMap` dibuja un `<picture>` con la imagen de `maps.googleapis.com/maps/api/staticmap`: el mismo `map_id`, el mismo zoom (16, `PLACE_MAP_ZOOM` en `src/lib/place-map.ts`, compartido con `MapView`), `language=es`, `region=UY` y `scale=2`. El marcador es `public/map-markers/<clave>.png` con `anchor:center|scale:2`. La URL se arma y se firma en `src/server/places/static-map.ts` (HMAC-SHA1, probado con el ejemplo de la documentación de Google) y **la pide el navegador directo a Google**: no pasa por nuestro servidor ni por `next/image`, y no se guarda.

**Tamaño exacto, sin JS.** El recuadro mide el ancho de pantalla − 82 px (medido: 330 px en 412 de ancho) y es 16:10. Hay un `<source media>` firmado por tramo de ancho (320, 340, 360, 375, 390, 400, 412, 430, 480, 540, 600, 680 y 722; el máximo de Static Maps es 640). En 412 px se pidió exactamente `size=330x206`.

**Verificado en el build de producción (Puppeteer):**
- **Mobile (412 px): 0 pedidos de Maps JS** y ningún chunk de `@vis.gl`. Hay un solo pedido a `staticmap` (330×206), con `fetchpriority="high"`.
- **Desktop (1280 px): 0 pedidos a `staticmap`**: el `<source>` de `min-width: 900px` es un GIF vacío. Maps JS se monta como antes.

**Dos bugs que encontré y arreglé mientras verificaba:**
1. El hook nuevo de `use-deferred-mount.ts` no se había guardado (un `grep` previo en el mismo comando falló y cortó el `&&`), así que en mobile seguía montando Maps JS. De ahí salen las 4 cargas de Dynamic Maps de más en la tabla de costos.
2. React parte el `<picture>` en varios pedazos al hacer streaming, y el `<img>` llegaba en un pedazo aparte: el navegador lo parseaba fuera del `<picture>` y bajaba su `src` (la imagen chica de 238×149) **también en desktop**. Ahora el `src` del `<img>` es el GIF vacío y la imagen chica va como último `<source>`.

**Link y directions.** Con `google_place_id`, la imagen es un link (otra pestaña) al mismo `googleMapsHref` del botón "Google Maps", con el nombre accesible "Mapa con la ubicación de X: abrir en Google Maps (otra pestaña)". Con `TRACK_EVENTS` va dentro de `DirectionsTracker`, así que cuenta como `directions` igual que el botón.

**Prioridad.** `mapLikelyAboveFold` (`PlacePage/utils/static-map.ts`, con tests) estima dónde empieza el mapa en un teléfono de 390×844. Lo calibré midiendo 13 fichas publicadas en Chrome: el mapa empieza entre 566 y 720 px, o sea que siempre entra en la primera pantalla. Sólo una descripción muy larga lo deja sin `fetchpriority`.

**Marcador.** Generé 46 PNG con `scripts/map-marker-pngs.mts` (con `sharp`, que ya viene con Next): un círculo blanco con sombra y el ícono, 64×64 al doble. Hay un test que exige uno por ícono más `default.png`. **Diferencias visibles con desktop:**
- Static Maps acepta íconos de hasta 64×64 px, así que el círculo mide 29 px, como el marcador en reposo. En desktop la ficha muestra el **activo**: 45 px con anillo negro.
- Sin categoría, `default.png` es el círculo con un punto, porque el emoji 🍽️ no se puede dibujar ahí.

**Lo que no pude verificar (falta el secreto):** cómo se ve la imagen, que el estilo del Map ID salga igual, la atribución y si Google respeta `scale:2` en el ícono. Además, en local Google no puede bajar el PNG desde localhost: la imagen sale sin marcador hasta un preview de Vercel (usa la URL del propio deploy; si el preview tiene Deployment Protection, tampoco llega) o producción.

### Qué tenés que configurar

- **Variable nueva:** `GOOGLE_MAPS_SIGNING_SECRET` (el "URL signing secret" de Google Cloud → Google Maps Platform → Claves y credenciales). Es sólo del servidor y sin `NEXT_PUBLIC_`. Va en `app/.env.local` y en Vercel en **Production y Preview** (y en Development si usan `vercel env pull`). Está documentada en `.env.example`. Sin ella no hay imagen: queda el recuadro liso y un `console.warn`.
- **Google Cloud:** habilitar **Maps Static API** y agregarla a las restricciones de API de la clave de navegador (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`). La restricción por referrer sirve tal cual. Opcional: poner en 0 la cuota de pedidos sin firmar de Static Maps.

### La regla "nunca una imagen de Google"

El commit que la escribió (7223298) y el comentario de `MapColumn.module.scss` sólo dan **un motivo visual**: en /search, un fondo de color liso hasta que Google dibuja. La palabra "captura" apunta a un **segundo motivo, los términos de Google Maps Platform**: no se puede guardar, cachear ni servir desde nuestro lado una captura del mapa. No encontré nada más en el código ni en el historial. Una imagen de Static Maps pedida en vivo por el navegador, sin modificar y con la atribución adentro, está permitida. AGENTS.md quedó así: mapa interactivo en /search y en la ficha en desktop, Static Maps en la ficha en mobile, y nunca una captura ni una imagen de Google guardada o servida por nosotros.

## 2. Ficha: lo de la base no espera a Google

- `getPlacePage` espera la fila y los descuentos (una consulta a la base: van debajo del mapa y, si llegaran después, moverían lo de abajo). Devuelve **promesas ya lanzadas** para Google, las sucursales y los parecidos.
- `Details` dibuja enseguida el header, el logo, el resumen, el mapa, el barrio y los descuentos. Lo de Google llega en `Suspense` propios, **todos de la misma promesa**, con el lugar reservado:

| Parte | Mientras llega Google |
|---|---|
| Estado ("Abierto…") | Con horarios de la base sale directo y Google no lo cambia (`baseHoursKnown`), igual que la regla de antes. Si la base no los tiene, va una línea vacía del mismo alto; si Google no trae `openNow`, queda vacía sin saltar. |
| Puntaje | Un hueco invisible del ancho de "★ 4,6 en Google", al final de la línea de categoría y precio. |
| Dirección | Una línea reservada. |
| Contacto + horarios | Instagram y "Lo que publica la gente" ya visibles; los horarios con la semana reservada (invisible, `inert`). |
| Sucursales / parecidos | Un `Suspense` cada uno, al final de la página (aparecer no mueve nada de arriba). |

- **Mismas llamadas a Google, ninguna nueva.** `google-cost-guard.test.ts` pasa sin cambios: `Details` sigue dentro de `<Suspense>`, sigue siendo lo único que llama a `getPlacePage`, y Place Details sigue pidiéndose sólo desde `page-data.ts`.
- **CLS medido:** 0,0001 en mobile, en las 3 corridas (lo mismo que antes; es el cambio de fuente del título).
- **Límites de la reserva** (rara vez se dan, y siempre debajo de lo visible):
  - Si Google trae web o WhatsApp, esos botones entran en la fila de contacto y pueden empujarla una línea.
  - Si un lugar no tiene horarios en Google, la reserva de la semana desaparece.
  - En mobile esa tarjeta suele estar fuera de la primera pantalla; en desktop está a la derecha y crecer no mueve nada.
- **Pendiente (no es de esta tanda):** en desktop hay un corrimiento de **0,0125** a los ~140 ms. Es el `<main>` con el skeleton "Cargando lugar…" que baja 17 px cuando el header mide su espaciador al hidratar, el mismo motivo por el que la home pasó a `sticky`. No toqué el header ni el skeleton y no lo comparé contra el build anterior.

## 3. Sacar motion

- La rotación del placeholder es CSS. El ejemplo que entra y el que sale se cruzan con `@keyframes` (0,4 s, la misma curva), y el que sale se borra en `onAnimationEnd`. El primero no se anima, como el `initial={false}` de antes.
- `prefers-reduced-motion` se lee con un hook chico (`matchMedia` + `useSyncExternalStore`): con movimiento reducido no rota, como antes, y el SCSS además apaga la animación.
- `motion` no se usaba en ningún otro lado: salió con `yarn remove motion`. En /search pesaban unos 45 KB gz de JS.

## 4. Fuentes

La **licencia de Fontshare (ITF FFL 2.0, del 17/8/2026) permite servirlas desde el sitio propio** ("You may self-host the Font Software on your own servers…"), pero:
- prohíbe distribuirlas "through another … repository … publicly accessible servers", y `mateoblanco/city_plans` es **público**;
- prohíbe subsetearlas y convertirlas de formato.

Por eso no se sirven desde el proyecto. El preconnect a `cdn.fontshare.com` (lo mínimo que se había pedido) se probó y se sacó por la medición de arriba: las fuentes quedaron exactamente como antes de la tanda (`layout.tsx` sin cambios). Para servirlas desde el proyecto haría falta hacer el repo privado, o bajar los woff2 oficiales en el build a una carpeta ignorada por git. En los dos casos, `next/font/local` con los archivos sin tocar (sin subset).

## 5. Íconos repetidos con `mask-image`

- En el HTML de producción, los únicos íconos repetidos muchas veces eran **el corazón** (62 en la home, 71 en /search) y **el de descuento** (53 en la home). Los demás aparecen 8 veces o menos y pesan menos de 400 bytes cada uno.
- Ahora son un `<span aria-hidden>` con `mask: url('/icons/….svg')` y `background-color`:
  - corazón de la card: `currentColor`, o `--color-like` si está guardado (12 px, como el `<svg>` del botón);
  - corazón de la ficha: `currentColor` en los dos estados, como antes (16×14);
  - chip de banco: el blanco del texto del chip (12 px).
- Los SVG pasaron a `public/icons/`, sin procesar por svgr.
- Lo comparé en capturas: card sin guardar (contorno), guardada (relleno rojo) y chips de Itaú e Itaú Personal Bank (ícono blanco). Se ven igual.
- **El nombre accesible no cambia:** "Guardar hugo resto & café", con `aria-pressed` false → true al tocarlo. En la ficha, el texto "Guardar"/"Guardado".
- Agregué la convención a AGENTS.md.

## Calidad

- `yarn test`: **80 archivos, 1587 tests, todos pasan**. Incluye `google-cost-guard.test.ts` sin cambios y los nuevos: firma y URL de Static Maps, PNG del marcador, estimación del primer viewport y `baseHoursKnown`.
- `tsc --noEmit`: sin errores.
- `yarn lint`: sin errores ni warnings.
- `yarn build`: OK.

## Archivos

- **Nuevos:**
  - `src/server/places/static-map.ts`
  - `src/lib/place-map.ts`
  - `PlacePage/PlaceMap/StaticMap/`
  - `PlacePage/utils/static-map.ts`
  - `PlaceHeader/PlaceActions/PlaceActions.module.scss`
  - `scripts/map-marker-pngs.mts`
  - `public/map-markers/` (46 PNG, 184 KB)
  - `public/icons/` (los 3 SVG movidos)
  - sus tests
- **Cambiados:**
  - `page-data.ts`, `PlacePage.tsx`, `PlaceSummary`, `PlaceLocation`, `PlaceBranches`, `SimilarPlaces`, `PlaceMap`, `MapView`, `use-deferred-mount.ts`, `utils/summary.ts`
  - `Search.tsx` + `.module.scss`, `layout.tsx`, `BankChip`, `SaveButton`, `PlaceActions`
  - `package.json`/`yarn.lock` (sin motion), `.env.example`, `AGENTS.md`

## Para probar

1. Agregá `GOOGLE_MAPS_SIGNING_SECRET` a `app/.env.local` y habilitá Maps Static API en la clave de navegador.
2. `yarn build && yarn start` y abrí una ficha a menos de 900 px de ancho: tiene que verse la imagen con el estilo del mapa y la atribución. En local, sin marcador.
3. En un preview de Vercel (con el secreto en Preview), revisá el marcador y su tamaño.
