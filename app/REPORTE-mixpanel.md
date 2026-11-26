# Reporte: Mixpanel para medir el uso de la web

Está todo implementado, sin commitear. Tests (1886, 29 nuevos), tipos y lint pasan.

**No toqué `search-href.ts`, `labels.ts` ni `PlaceCard.module.scss`.** Tus cambios de `Header.module.scss` y
`TabsLine.module.scss` ya estaban en el commit `68df200 fix`, antes de empezar, y la línea base de Lighthouse los
incluye.

## Antes de probar

- **Es un dependency nuevo:** corré `yarn install` (`mixpanel-browser` 2.86.0).
- **Para verlo local, sin enviar nada:**
  `MIXPANEL_DEBUG=true yarn build && MIXPANEL_DEBUG=true yarn start`. Con `yarn dev` alcanza con
  `MIXPANEL_DEBUG=true yarn dev`, pero ahí React en modo estricto corre dos veces algunos efectos y vas a ver eventos
  repetidos que en producción no salen.
- **Hace falta la variable también en `start`.** La home tiene partes dinámicas, así que el layout vuelve a leerla en
  cada pedido. En Vercel las variables están en los dos momentos, así que no cambia nada.
- **En la consola del navegador** sale `[mixpanel] <evento> {…}` con el payload final, el mismo que se mandaría.
- **Para producción:** cargar `MIXPANEL_TOKEN` (sin `NEXT_PUBLIC_`) solo en Production de Vercel y hacer un deploy.

## 1. Configuración y privacidad

| Pedido | Cómo quedó |
| --- | --- |
| Carga diferida | `ProductAnalytics` se monta en el layout. `track` empieza a funcionar al hidratar. La librería se baja después del `load` y con el navegador libre (`requestIdleCallback`), con `import()`. Uso la entrada `mixpanel-browser/src/loaders/loader-module-core`: la de por defecto trae el grabador de sesiones (rrweb) y pesa ~255 KB gzip. |
| Sin cookies ni almacenamiento | `disable_persistence: true`, más `batch_requests: false` (la cola de lotes de Mixpanel usa localStorage aunque no haya persistencia). Verificado en Chrome con la librería cargada: `document.cookie`, `localStorage`, `sessionStorage` e IndexedDB vacíos. El `distinct_id` vive en memoria: es el mismo en la navegación interna y otro al recargar. |
| Sin IP para geolocalizar | `ip: false`: Mixpanel manda `ip=0` en cada pedido y no guarda país ni ciudad. |
| Sin URL completa | `property_blacklist` saca `$current_url` y `current_url_search` (la URL tiene `q`, y un link viejo puede traer `near=lat,lng`), los referrers (`$referrer`, `$referring_domain`, `$initial_referrer`, `$initial_referring_domain`), `$search_engine`, `mp_keyword`, los UTM y los ids de clic (`gclid`, `fbclid`…). También van apagados `autocapture`, el `track_pageview` automático, `track_marketing` y `save_referrer`. El page view sale con `current_url_path` (la ruta sin query). |
| Nunca ubicación ni guardados | No están en los tipos. Además, `sanitize` saca cualquier clave `lat`, `lng`, `coords`, `distance*`, `near`, `saved*`, `likes` o `user_location` aunque alguien la pase. La ubicación de la búsqueda va solo como tipo (`near`, `all`, `zone`) o barrio, y `has_location` como sí/no. |
| Solo en producción | `productAnalytics()` en `src/server/product-analytics/config.ts`. Envía solo con `VERCEL_ENV=production` y `MIXPANEL_TOKEN`. En previews y en desarrollo el layout no monta nada y la librería no se baja. |
| Modo debug | `MIXPANEL_DEBUG=true`, solo fuera de producción. Carga la librería real con la misma configuración y un token de mentira. Un hook (`before_send_events`) escribe en la consola y cancela el envío: nunca sale un pedido a Mixpanel. |
| Bots | `isBot(navigator.userAgent)` o `navigator.webdriver`: se descarta la cola y no se baja la librería. |
| Convive con la popularidad | La popularidad propia no cambió. `place_viewed` usa el mismo origen que ella, con `viewOrigin()` en `Tracking/utils/track.ts`, que no consume el origen dos veces. |

**Token sin `NEXT_PUBLIC_`.** Lo charlamos: Vercel lo marcaba por llamarse TOKEN. El layout lo lee en el servidor y se
lo pasa al componente. El token de proyecto de Mixpanel igual viaja en cada evento, así que no es secreto; el API
secret no se usa.

### Peso (build de producción)

| Qué | Sin comprimir | gzip | brotli | Cuándo |
| --- | --- | --- | --- | --- |
| Librería (`mixpanel-core`) | 152 KB | 41,8 KB | 36,5 KB | Después del `load`, con el navegador libre |
| Componente + `track` + config | 12 KB | 4,5 KB | 3,9 KB | Al hidratar |

- **JS inicial transferido según Lighthouse:** home 355 → 357 KB y ficha 335 → 337 KB.
- **Costo de ejecutar la librería:** medido en Chrome mobile con la CPU 4 veces más lenta (como Lighthouse), 3 cargas.
  No hubo ninguna tarea larga (más de 50 ms) después de que se bajó.

### Lighthouse (mobile, build de producción, servidor caliente, 3 corridas, mediana)

"Después" es el build con `MIXPANEL_DEBUG=true`: la misma librería, la misma configuración y los mismos listeners que
producción, sin enviar.

| | Puntaje | FCP | LCP | TBT | CLS | Speed Index |
| --- | --- | --- | --- | --- | --- | --- |
| Home antes | 86 | 1555 ms | 4057 ms | 6 ms | 0 | 3063 ms |
| Home después | 87 | 1555 ms | 3980 ms | 7 ms | 0 | 2347 ms |
| Ficha antes | 81 | 1551 ms | 4956 ms | 3 ms | 0,022 | 1551 ms |
| Ficha después | 84 | 1554 ms | 4526 ms | 8 ms | 0,022 | 1554 ms |

- **Ninguna empeora.** Las diferencias de LCP y de Speed Index están dentro del ruido de esta máquina: la ficha antes
  dio 4354 y 4956 ms entre corridas.
- **Lo que Lighthouse no cubre:** baja el chunk del componente, pero no la librería, que llega después de que termina
  de medir. Por eso medí su costo aparte (arriba).
- **Un problema que encontré y corregí:** en una primera versión, el `page_view` vivía en el layout, con
  `usePathname` dentro de un `<Suspense>`. Eso dejaba un hueco dinámico más al final del HTML y la FCP de la home pasaba
  de 1555 a 1960 ms en las 3 corridas. Con la analítica apagada (mismo JS) volvía a 1554 ms. Pasé el `page_view` al
  `NavigationTracker` del header, que ya tiene su Suspense, y el layout quedó sin hueco. Lo anoté en el código y en
  `AGENTS.md`.

## 2. Un solo lugar para los eventos

- **Tipos:** `src/lib/product-analytics/events.ts`. `ProductEvents` tiene cada evento con sus propiedades y las listas
  de valores (`SEARCH_ORIGINS`, `SHARE_METHODS`, `EXTERNAL_LINKS`, `PAGE_TYPES`, `FILTER_KEYS`…).
- **Helper:** `track(evento, props)` en `src/lib/product-analytics/track.ts`, tipado contra `ProductEvents`. Un
  evento que no existe, una propiedad que falta o un valor fuera de la lista no compilan; el test lo verifica con
  `@ts-expect-error`, que `tsc` chequea. Mientras no se decide si medir, encola en memoria (tope 50), después manda en
  orden. Nunca tira error.
- **Server components:** `trackAttrs(evento, props)` devuelve atributos `data-pa` / `data-pa-props`, con el mismo
  tipado. Un solo listener de `click` y `auxclick` (click del medio) en `document` los lee. Así no hubo que convertir
  a cliente ningún componente de servidor (`DishCard`, `PlaceRow`, `ViewAllCard`, `FilterChip`, `IntentTabs`,
  `PlaceContact`, `BenefitLine`, `PlaceLocation`, `StaticMap`).
- **`Button` y `base/Link`:** les agregué una prop opcional `analytics`, que pasa esos atributos al elemento. No cambia
  nada visual.
- **Tracking plan:** `docs/tracking-plan.md`, con cada evento, cuándo se dispara y sus propiedades, más las reglas de
  privacidad.
- **`AGENTS.md`:** sección nueva "Analítica de producto (Mixpanel)".

## 3. Eventos: un ejemplo real de cada uno

Están capturados de la consola en modo debug, en Chrome contra el build de producción local. Les saco las propiedades
que agrega Mixpanel (ver el payload completo al final). Ninguno lleva coordenadas, distancias ni guardados.

**Búsqueda**

```text
search_submitted   {"query":"milanesa","tab":"eat","filters":{"location":["all"]},"results_count":199,"resolved_by":"dictionary","has_location":false,"origin":"bar"}
search_submitted   {"query":"Sushi","tab":"eat","filters":{"location":["all"]},"results_count":43,"resolved_by":"dictionary","has_location":false,"origin":"dish"}
search_submitted   {"query":"","tab":"cafes","filters":{"location":["all"],"open":["now"]},"results_count":222,"resolved_by":"filters","has_location":false,"origin":"home_row"}
search_submitted   {"query":"Pizza","tab":"eat","filters":{"location":["all"],"open":["now"]},"results_count":91,"resolved_by":"dictionary","has_location":false,"origin":"filter"}
search_submitted   {"query":"pizza","tab":"bars","filters":{"location":["near"]},"results_count":25,"resolved_by":"dictionary","has_location":true,"origin":"tab"}
search_submitted   {"query":"","tab":"cafes","filters":{"location":["zone"],"price":["low"],"open":["now"]},"results_count":4,"resolved_by":"filters","has_location":false,"origin":"zone"}
search_submitted   {"query":"restaurante submarino con vista a la luna","tab":"eat","filters":{"location":["all"]},"results_count":456,"resolved_by":"llm","has_location":false,"origin":"bar"}
search_submitted   {"query":"","tab":"all","filters":{"location":["all"],"discount":["brou.debit"]},"results_count":30,"resolved_by":"filters","has_location":false,"origin":"link"}
search_no_results  {"query":"sushi","tab":"eat","filters":{"location":["zone"]},"results_count":0,"resolved_by":"dictionary","has_location":false,"origin":"link"}
filter_changed     {"filter":"open","value":"now"}
filter_changed     {"filter":"price","value":"low"}
filter_changed     {"filter":"location","value":"CORDON"}
intent_tab_selected {"tab":"bars"}
search_result_clicked {"place_id":"a89f0d2f-…","slug":"cantina-del-mirador-rosado","position":2,"surface":"list","query":"milanesa"}
search_result_clicked {"place_id":"a0ea2ae1-…","slug":"pizzeria-la-9","position":11,"surface":"map","query":"pizza"}
map_zone_search    {}
```

**Ficha**

```text
place_viewed          {"place_id":"a89f0d2f-…","slug":"cantina-del-mirador-rosado","origin":"search","row":null}
place_viewed          {"place_id":"070b81bc-…","slug":"ramona-wtc","origin":"home","row":"coffee"}
place_viewed          {"place_id":"9826e708-…","slug":"matute","origin":"guide","row":"primera-cita"}
place_viewed          {"place_id":"3efdb1da-…","slug":"escaramuza","origin":"direct","row":null}
place_saved           {"place_id":"070b81bc-…","slug":"ramona-wtc","origin":"home"}
place_unsaved         {"place_id":"070b81bc-…","slug":"ramona-wtc","origin":"home"}
directions_clicked    {"place_id":"070b81bc-…","slug":"ramona-wtc"}
share_clicked         {"place_id":"070b81bc-…","slug":"ramona-wtc","method":"copy"}
share_clicked         {"place_id":"070b81bc-…","slug":"ramona-wtc","method":"whatsapp"}
external_link_clicked {"place_id":"49b5878f-…","slug":"telizzia","link":"instagram"}
discount_info_clicked {"place_id":"49b5878f-…","slug":"telizzia","bank":"brou"}
```

**Home y guías**

```text
home_row_clicked     {"place_id":"070b81bc-…","slug":"ramona-wtc","row":"coffee","position":3}
home_see_all_clicked {"row":"coffee"}
dish_clicked         {"dish":"Sushi"}
guide_viewed         {"guide":"primera-cita"}
guide_place_clicked  {"place_id":"9826e708-…","slug":"matute","guide":"primera-cita","position":2}
```

**Configuración y navegación**

```text
location_permission {"result":"granted"}
location_permission {"result":"denied"}
welcome_completed   {"cards":["brou.debit"]}
welcome_skipped     {"step":"cards"}
welcome_skipped     {"step":"places"}
$mp_web_page_view   {"current_page_title":"Bares abiertos ahora en Montevideo · A Dónde Vamos","current_domain":"localhost","current_url_path":"/search","current_url_protocol":"http:","page_type":"search"}
```

El page view de arriba salió de una URL con `utm_source`, `gclid` y `near=-34.9,-56.1`, y no llevó ninguno. En la
primera tanda, el page view salía como evento propio `page_view`, con `page_type` y `path`; el comportamiento era el
mismo: salió una sola vez por página, también en la navegación interna (home → ficha por click). En la ficha
llega después de `place_viewed` porque el efecto del header corre después que el de la página; no cambia nada en
Mixpanel, que ordena por `time`.

**Payload completo** de `search_submitted`, tal como lo armaría Mixpanel. En producción, `token` es el real.

```json
{
  "$os": "Mac OS X", "$browser": "Chrome", "$browser_version": 131,
  "$screen_height": 600, "$screen_width": 800,
  "mp_lib": "web", "$lib_version": "2.86.0",
  "$insert_id": "pojsrmvhe9ttpijt", "time": 1795724227.174,
  "distinct_id": "$device:6f2792d2-5ec9-4bd5-8360-12fef50cdb72",
  "$device_id": "6f2792d2-5ec9-4bd5-8360-12fef50cdb72",
  "query": "milanesa", "tab": "eat", "filters": { "location": ["all"] },
  "results_count": 199, "resolved_by": "dictionary", "has_location": false, "origin": "bar",
  "token": "debug"
}
```

### Cómo se decide cada cosa

- **`search_submitted`:**
  - Sale cuando se muestra la lista de una búsqueda nueva. `ResultsView` se vuelve a montar con cada `searchKey`, y
    el resumen lo arma el server (`searchSummary` en `SearchPage/utils/search-analytics.ts`).
  - Volver atrás a una búsqueda ya vista no cuenta: Next restaura la página sin volver a montarla.
  - Los refinamientos (filtro, pestaña, zona) cuentan, con su origen, como decidiste.
  - `results_count` suma los de "Cerca de <barrio>".
- **Diccionario o LLM:**
  - Agregué `SearchResponse.resolvedBy` en `server/search/search.ts`: el `source` de debug, con `shortcut` como
    `dictionary`, sin modelo ni costo.
  - También aparece en `/api/search` (es la misma respuesta).
- **Origen:** lo marca lo que dispara la búsqueda:
  - el submit del buscador;
  - los eventos `dish_clicked`, `home_see_all_clicked`, `filter_changed`, `intent_tab_selected` y `map_zone_search`,
    que lo marcan solos.
  - Sin marca, es `link`.
- **`position` en `/search`:** es el puesto en el ranking de la respuesta. Lo anota `ResultsView`, así sirve también
  para la card flotante del mapa, que vive fuera de la lista.
- **Bienvenida:**
  - `welcome_completed` sale con "Listo", o al cerrar después de confirmar tarjetas con "Siguiente".
  - Si no, `welcome_skipped` con el paso donde se cerró.
  - Nunca se mandan los lugares elegidos: son guardados.
- **`location_permission`:** sale en `requestLocation()`, con el resultado del diálogo del navegador. Si falla o se
  vence el tiempo, no sale.

### Lo que no pude verificar en vivo

- **`share_clicked` con `native`:** Chrome headless no tiene Web Share API. El código es una línea:
  `typeof navigator.share === "function"` en el mismo click. Probalo en el teléfono.
- **`external_link_clicked` con `web` o `whatsapp`:** salen de Google y los lugares que abrí no los traían. Usan el
  mismo atributo que `instagram`, que sí probé.
- **`phone`:** queda en el tipo, pero la ficha no muestra teléfono, así que nunca se dispara.
- **Origen `guide` de `search_submitted`:** está en el tipo, pero hoy ninguna guía tiene links a búsquedas.
- **`location_permission` con `granted` y `has_location: true`:** los capturé en una corrida directa contra el
  servidor local. En el recorrido completo usé un proxy por CDP: el servidor de prueba estaba en 3100, la clave de Maps
  solo acepta `localhost:3000`, y en 3000 había un servidor tuyo que no toqué. Ese proxy rompía la cookie de ubicación.

## 3 bis. Segunda tanda: eventos nuevos y page view nativo

### El page view ahora es el de Mixpanel

En la primera tanda mandaba un evento propio `page_view`, con `track_pageview: false`. Tenías razón: Mixpanel tiene
su propio page view, `$mp_web_page_view`, que es el que usan sus reportes de páginas.

- **Cómo se manda ahora:** `Header/NavigationTracker` llama a `mixpanel.track_pageview({ page_type })`, en cada carga y
  en cada cambio de ruta interna. Uso la llamada manual y no `track_pageview: "url-with-path"` en el init, para
  controlar qué se manda.
- **Qué agrega Mixpanel:** `current_url_path`, `current_domain`, `current_url_protocol` y `current_page_title`.
- **Lo que bloqueé:**
  - `current_url_search`: la query, que trae `q` y puede traer `near=lat,lng` de un link viejo.
  - Los UTM y los ids de clic (`gclid`, `fbclid`…), que `track_pageview` suma solo.
  - Apagué `track_marketing`, que mandaba los UTM en todos los eventos.
- **Si querés medir campañas con UTM:** hay que sacarlos del bloqueo y nombrarlos en la política, porque hoy dice que
  mandamos la dirección sin parámetros.
- **Rendimiento:** no cambia. Es la misma llamada en el mismo lugar, así que no repetí Lighthouse.

Ejemplo real, de `/search?q=bares abiertos ahora&loc=all&utm_source=newsletter&gclid=abc123&near=-34.9,-56.1`:

```text
$mp_web_page_view {"current_page_title":"Bares abiertos ahora en Montevideo · A Dónde Vamos","current_domain":"localhost","current_url_path":"/search","current_url_protocol":"http:","page_type":"search"}
```

### Eventos nuevos (ejemplos reales, modo debug)

```text
chip_removed       {"filter":"open","chip":"now","from_text":true}
results_load_more  {"visible_count":42,"total_count":160,"page":2}
results_load_more  {"visible_count":54,"total_count":160,"page":3}
map_marker_clicked {"place_id":"27513946-…","slug":"ramon","position":60}
```

- **`results_load_more`:**
  - No es un botón "Ver más": la lista suma la página siguiente sola, al acercarse al final.
  - `visible_count` son las cards que ya se veían, contando los grupos. Por eso la primera vez da 42 y no 12.
- **`map_marker_clicked`:**
  - Lleva el lugar y el puesto en el ranking, nunca coordenadas.
  - En mobile, si después se toca la card flotante, sale además `search_result_clicked` con `surface: map`.
- **`chip_removed`:**
  - Sale al quitar un chip activo de la barra: "Abierto ahora", un sub-filtro o un extra (`tag:`, `section:`,
    "Cerca de"). Dice cuál y si lo había puesto el texto.
  - Reemplaza al `filter_changed` con `-` que mandaban esos chips.
  - Desmarcar algo en un select (precio, dieta, descuentos, "Dónde") sigue siendo `filter_changed`.
  - Cuenta como refinamiento: la búsqueda que sigue lleva `origin: "filter"`.

### La sugerencia de ampliar ("Sacá Cordón para ver N más") no existe

La propuse leyendo `AGENTS.md`, pero el componente (`WidenInvite`) se sacó en el commit `cbb0c78`.

- **Lo que hay hoy al final de la lista:** `EndOfResults`, un texto fijo: "No hay más resultados. Probá sacar algún
  filtro o hacé otra búsqueda."
- **Lo que quedó sin usar:** la ruta `/api/search/widen` y `widenUrl` de `search-href.ts`. Tampoco se muestran los
  `suggestedRemovals` de la respuesta.
- **`AGENTS.md`:** la línea "Invitación a ampliar" todavía lo describe como si existiera. No la toqué.
- **Qué hice:** no agregué ese evento.

### Texto normalizado en las búsquedas

`search_submitted` y `search_no_results` mandan, además de `query` (el texto tal cual), `query_normalized`: el texto
en minúsculas, sin tildes, sin espacios repetidos ni en las puntas, con un máximo de 100 caracteres.

- **Qué función usa:** `normalize` de `shared/tags.ts`, la misma del buscador, así agrupa igual que la búsqueda.
- **La ñ:** también pierde la tilde (`Ñoquis del Año` da `noquis del ano`), como en el buscador.
- **`query` en la práctica:** llega sin los espacios de las puntas, porque `readParams` ya los saca de la URL.

```text
query: "Café   TRANQUILO en Cordón"  →  query_normalized: "cafe tranquilo en cordon"
```

### Tercera tanda: ajustes después de producción

**1. Refinar dentro de `/search` ya no es una búsqueda nueva.**
- **La causa:** el "Ver todos" de las secciones de resultados (`section:casual`, "Cerca de", grupos por banco) no
  tenía analítica. Por eso disparaba un `search_submitted` sin origen, que salía como `link`.
- **El "Ver todos" de una sección:** ahora manda `filter_changed {"filter":"section","value":"share"}`.
- **La regla nueva:** `search_submitted` sale solo cuando la persona envía un texto (buscador, plato, "Ver todos" de
  una fila de la home) o llega a `/search` desde otra página o la abre directo.
- **Lo que quedó afuera:** filtros, sub-filtros, secciones, chips, pestañas y "Buscar en esta zona" dentro de
  `/search` mandan solo su propio evento.
- **Cómo se decide:** `isNewSearch` en `track.ts`. `NavigationTracker` avisa cuando se sale de `/search`.
- **Consecuencia:** un refinamiento que deja cero resultados ya no manda `search_no_results`.

**2. Orígenes renombrados.**
- **El buscador:** `bar` pasó a `search_bar`.
- **Una pestaña:** `tab` pasó a `intent_tab`. Ningún valor coincidía con un tab, pero se llamaba igual que la
  propiedad `tab`.
- **`zone`:** salió. "Buscar en esta zona" solo existe dentro de `/search`, así que ya no puede iniciar una búsqueda
  nueva.
- **`filter` e `intent_tab`:** quedan solo para cuando se llega desde los filtros o las pestañas de la home.
- **Test nuevo:** falla si un origen coincide con un valor de `tab`.

**3. `page_type` en la vista de página.**
- **Ya se mandaba:** el `$mp_web_page_view` llevaba `page_type` desde la segunda tanda (`track_pageview({ page_type })`),
  y es la única vista por página.
- **Si no lo ves en producción,** puede ser una de dos cosas:
  - el deploy tiene la primera versión, que todavía mandaba un `page_view` propio;
  - Mixpanel no lo muestra en la vista por defecto del evento. Abrí el evento o agregá la propiedad.
- **Lo que cambia:** se suma el valor `guides_city` para `/guides/montevideo` (y `/guides`).
- **Limitación:** `/guides/montevideo/<barrio>` comparte la ruta con las guías y queda como `guide`.

Ejemplos reales (modo debug):

```text
dish_clicked        {"dish":"Pizza"}
$mp_web_page_view   {"current_url_path":"/search","page_type":"search"}
search_submitted    {"query":"Pizza", … ,"origin":"dish"}
filter_changed      {"filter":"open","value":"now"}                       ← sin search_submitted
search_submitted    {"query":"cena con amigos", … ,"origin":"search_bar"}
filter_changed      {"filter":"section","value":"share"}                  ← sin search_submitted
intent_tab_selected {"tab":"bars"}                                       ← sin search_submitted
filter_changed      {"filter":"sub","value":"cocktails"}                  ← sin search_submitted
intent_tab_selected {"tab":"cafes"}                                      (desde la home)
search_submitted    {"query":"", … ,"tab":"cafes","origin":"intent_tab"}
$mp_web_page_view   {"current_page_title":"Guías de Montevideo: …","current_url_path":"/guides/montevideo","page_type":"guides_city"}
```

## 4. Política de privacidad

Archivo: `LegalPage/content/privacy.tsx`. La fecha de "Última actualización" pasa a **2026-11-26**
(`src/lib/legal.ts`).

- **"En pocas palabras":** una línea nueva sobre Mixpanel, con qué le mandamos y qué no. Sin cookies y sin
  reconocerte entre visitas.
- **"Qué datos tratamos":** un apartado nuevo, "Lo que mandamos a Mixpanel".
- **Sección nueva, "Cómo se usa el sitio (Mixpanel)" (`#uso`):**
  - Quién es (Mixpanel, Inc., Estados Unidos) y para qué se usa.
  - Qué le mandamos: eventos de uso, el texto de las búsquedas (hasta 100 caracteres) con los filtros, si había
    ubicación (sí/no), las tarjetas de la bienvenida y los datos técnicos que agrega Mixpanel.
  - Qué no le mandamos: ubicación, guardados ni la URL completa. Recibe la IP por la conexión, pero no la usa para
    ubicarte.
  - Que no usa cookies ni almacenamiento: es un código al azar en memoria, que se pierde al recargar.
  - Sin robots y sin publicidad.
  - El link a su política de privacidad.
- **"Medición anónima de visitas":** decía que el texto de búsqueda "no llega a la analítica". Ahora dice que no llega
  a Vercel Analytics y sí a Mixpanel.
- **"Tus búsquedas":** un párrafo nuevo: el texto también llega a Mixpanel.
- **"Servicios de terceros":** Mixpanel en la lista. La transferencia internacional ahora nombra los eventos de uso.
- **"Cookies":** aclara que Mixpanel tampoco usa cookies ni guarda nada en el navegador.
- **"Cuánto tiempo conservamos":** una fila nueva, "Eventos de uso y texto de las búsquedas" en Mixpanel, "Según la
  política de Mixpanel".
- **"Tus derechos":** no podemos saber qué eventos son tuyos, porque el código se pierde al recargar.

Segunda tanda: "Eventos de uso" ahora nombra el título de la página, los lugares tocados en el mapa y hasta dónde se
bajó en una lista de resultados.

## 5. Interacciones que no estaban en la lista

En la segunda tanda implementé "Ver más" (`results_load_more`), el marcador del mapa (`map_marker_clicked`) y quitar
un chip (`chip_removed`). El resto sigue sin implementar.

| Propuesta | Por qué |
| --- | --- |
| `results_load_more` ("Ver más" / scroll del final, con la página) | Dice si la gente pasa de los primeros 12. |
| `map_marker_clicked` | Hoy solo cuenta el click en la card flotante (mobile). Tocar un marcador en desktop no cuenta. |
| `widen_clicked` ("Sacá Cordón para ver N más", con el filtro) | Mide si sirve la invitación a ampliar. |
| `chip_removed` (quitar un chip del texto) y `search_cleared` (× del buscador) | Hoy quitar un chip del texto no es `filter_changed`, porque solo van los de la barra. |
| `similar_place_clicked` / `branch_clicked` (ficha) | El origen ya llega en `place_viewed` (`similar`, `branch`), pero no el puesto. |
| `place_guide_clicked` ("Aparece en estas guías") y `home_guide_clicked` (la sección Guías de la home) | Entradas a las guías. |
| `rating_link_clicked` (reseñas en Google) y `social_posts_clicked` ("Lo que publica la gente") | Otros links externos de la ficha. |
| `guide_map_opened` ("Ver mapa" en mobile) | Uso del mapa en las guías. |
| `hours_expanded` ("Ver todos los horarios") | Si se miran los horarios. |
| `welcome_place_selected` (cuántos lugares eligió, sin cuáles) | Mediría la bienvenida, pero roza "nunca sus guardados". Lo dejaría afuera salvo que quieras la cantidad. |

## Pendientes y decisiones tuyas

- **Mixpanel:** crear el proyecto (servidor de datos en Estados Unidos, como dice la política) y cargar
  `MIXPANEL_TOKEN` en Production de Vercel.
- **Conservación de los datos:** revisá en Mixpanel cuánto tiempo guarda los datos según tu plan. La política dice
  "según la política de Mixpanel"; si querés un plazo concreto, lo pongo.
- **Aviso en el sitio:** la política, en "Cambios", dice que un proveedor nuevo se avisa también en el sitio. No hay
  ningún aviso armado; decime si lo querés y dónde.
- **Lo que gasté probando:**
  - Unas 25 vistas de ficha, entre Chrome y Lighthouse: cada una pide Place Details a Google (~USD 0,02), así que
    ~USD 0,50.
  - Dos búsquedas con el LLM ("restaurante submarino…"), de menos de un centavo.

## Archivos

**Nuevos**
- `src/lib/product-analytics/`: `events.ts`, `track.ts`, `load.ts`, `page-type.ts` y `test/` (`events`, `track`,
  `load`).
- `src/server/product-analytics/config.ts` y `test/config.test.ts`.
- `src/components/ProductAnalytics/`:
  - `ProductAnalytics.tsx`
  - `PlaceViewed/`
  - `GuideViewed/`
  - `utils/saved.ts`
- `src/components/pages/SearchPage/utils/`:
  - `search-analytics.ts` y su test
  - `use-track-search.ts`
  - `result-positions.ts`
- `docs/tracking-plan.md`
- este reporte

**Modificados**
- **Configuración y documentación:** `package.json` y `yarn.lock`, `.env.example`, `AGENTS.md`.
- **Layout y búsqueda:**
  - `app/layout.tsx`
  - `server/search/search.ts` (`resolvedBy`)
  - `Search.tsx`, `ResultsView`, `SearchResults`, `PlaceCard.tsx`, `SelectedPlace`, `ZoneButton`
- **Barra de filtros:**
  - `FilterBar`, `FilterChip`, `FilterSelect`
  - `PriceSelect`, `DietSelect`, `DiscountFilter`, `LocationSelect`
  - `use-delayed-apply.ts`, `IntentTabs`, `use-location.ts`
- **Header y componentes base:** `Header/NavigationTracker`, `base/Button`, `base/Link`.
- **Popularidad:** `Tracking/OriginLink` (`onOpen`) y `Tracking/utils/track.ts` (`viewOrigin`).
- **Ficha:**
  - `PlacePage`, `PlaceHeader`, `PlaceActions`, `ShareButton`, `ShareMenu`, `SaveButton`
  - `PlaceInfo`, `PlaceContact`, `PlaceLocation`, `StaticMap`
  - `PlaceDiscounts`, `ProviderDiscounts`, `BenefitLine`
- **Home y guías:** `DishCard`, `PlaceRow`, `WelcomeDialog`, `GuidePage`, `GuideItem`.
- **Legal:** `LegalPage/content/privacy.tsx`, `src/lib/legal.ts`.
