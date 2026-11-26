# Tracking plan: analítica de producto (Mixpanel)

Qué mandamos a Mixpanel para entender cómo se usa el sitio. Los nombres y propiedades salen de los tipos de
`src/lib/product-analytics/events.ts` (`ProductEvents`): si se cambia uno, se cambia el otro. Si se agrega un dato
nuevo, también va en la Política de privacidad (sección `uso`), subiendo su fecha en `src/lib/legal.ts`.

Mixpanel convive con la popularidad propia (`/api/events`, `TRACK_EVENTS`) y con Vercel Web Analytics. No reemplaza a
ninguno de los dos.

## Reglas

- **Nunca la ubicación de la persona.** Ni coordenadas, ni distancia, ni radio, ni los bordes de una zona. La ubicación
  va solo como tipo (`near`, `all`, `zone`) o como barrio (`neighborhood:CORDON`), y `has_location` dice solo sí o no.
- **Nunca sus guardados.** Ni la lista, ni cuántos tiene, ni los lugares que eligió en la bienvenida.
  `place_saved`/`place_unsaved` mandan solo el lugar tocado.
- **El texto de búsqueda sí va**, recortado a 100 caracteres: tal cual (`query`) y normalizado (`query_normalized`).
- **Sin la URL completa ni sus parámetros.** Están bloqueados (`property_blacklist`): `$current_url`,
  `current_url_search` (la query del page view, con `q` y un `near=lat,lng` de un link viejo), los referrers, los UTM y
  los ids de clic de publicidad (`gclid`, `fbclid`…). También va `track_marketing: false`.
- **Sin cookies ni almacenamiento.** `disable_persistence` y `batch_requests: false`. El identificador
  (`distinct_id`/`$device_id`) vive en memoria: sobrevive a la navegación interna de Next, no a una recarga.
- **Sin geolocalización por IP** (`ip: false`): Mixpanel no registra país ni ciudad.
- **Sin bots:** `isBot` por user agent y `navigator.webdriver`.
- **Solo en Production de Vercel** con `MIXPANEL_TOKEN`. `MIXPANEL_DEBUG=true` (fuera de producción) escribe en la
  consola lo que mandaría y no envía.
- Se manda solo con `track()` o `trackAttrs()`. `sanitize` saca igual las claves de ubicación o guardados, y
  `events.test.ts` falla si una propiedad se llama así.

Mixpanel agrega solo `$os`, `$browser`, `$browser_version`, `$screen_width`, `$screen_height`, `$device_id`,
`distinct_id`, `$insert_id`, `time`, `mp_lib` y `$lib_version`.

`place_id` es el uuid del lugar y `slug` el de su URL. `position` va siempre desde 1.

## Navegación

| Evento | Cuándo | Propiedades |
| --- | --- | --- |
| `page_view`, que en Mixpanel es `$mp_web_page_view` | Al cargar cada página y en cada cambio de ruta interna de Next (`Header/NavigationTracker`). Cambiar solo la query (otra búsqueda en `/search`) no cuenta: para eso está `search_submitted`. Es el page view nativo de Mixpanel (`track_pageview()`), el que usan sus reportes de páginas: hay una sola vista por página (no se manda un `page_view` propio aparte, ni el automático de la librería). | `page_type`: `home` (`/`), `search` (`/search`), `place` (`/place/<slug>`), `guides_city` (`/guides/montevideo`, y `/guides`, que redirige ahí), `guide` (`/guides/montevideo/<slug>`: una guía; la página de un barrio comparte la ruta y también cae acá), `legal` (`/privacy`, `/terms`) u `other` (el 404).<br>Además, los que agrega Mixpanel: `current_url_path` (la ruta, `/place/escaramuza`), `current_domain`, `current_url_protocol` y `current_page_title`. En una navegación interna el título puede no venir: Next lo cambia después. |

## Búsqueda

| Evento | Cuándo | Propiedades |
| --- | --- | --- |
| `search_submitted` | Una búsqueda nueva, cuando se muestra su lista: **la persona envía un texto** (el buscador, un plato, el "Ver todos" de una fila de la home) **o llega a `/search` desde otra página** (o la abre directo). **Dentro de `/search`, refinar no es una búsqueda nueva**: un filtro, un sub-filtro, el "Ver todos" de una sección, quitar un chip, una pestaña o "Buscar en esta zona" mandan solo su evento (`filter_changed`, `chip_removed`, `intent_tab_selected`, `map_zone_search`). Volver atrás a una búsqueda ya vista tampoco cuenta. | `query`: el texto tal cual lo escribió la persona (sin los espacios de las puntas, que saca la URL), máximo 100; vacío si fue solo con filtros.<br>`query_normalized`: el mismo texto en minúsculas, sin tildes, sin espacios repetidos ni en las puntas, máximo 100 (`normalize` de `shared/tags.ts`, el que usa el buscador). Agrupa búsquedas iguales: "Café  Cordón" y "cafe cordon" dan `cafe cordon`. También saca la tilde de la ñ: "Ñoquis" da `noquis`.<br>`origin`: de dónde salió, ver abajo.<br>`tab`: la intención activa (`eat`, `bars`, `cafes`, `desserts`) o `all`.<br>`filters`: los activos por tipo, ver abajo.<br>`results_count`: los resultados más los de "Cerca de".<br>`resolved_by`: `dictionary`, `llm`, `name` (fijado por nombre), `fallback` (falló el modelo) o `filters` (sin texto).<br>`has_location`: si había coordenadas en la cookie (sí o no). |
| `search_no_results` | Junto con `search_submitted` cuando `results_count` es 0. Un refinamiento que deja cero resultados no lo manda, porque no es una búsqueda nueva. | Las mismas. |
| `filter_changed` | Al aplicar un filtro de la barra o tocar el "Ver todos" de una sección de resultados. | `filter`: `location`, `price`, `diet`, `discount`, `open`, `sub`, `extra` o `section`.<br>`value`: en los selects, lo elegido separado por comas (`low`, `vegan,glutenFree`, `itau.credit`) o `none`; en "Dónde", `near`, `all` o los barrios (`CORDON,POCITOS`), nunca coordenadas; en los chips, el id del que se prende (`now`, `cocktails`); en `section`, el id del grupo (`casual`, `share`, `world`, `discount:itau`, `nearby` para "Cerca de"). Quitar un chip es `chip_removed`. |
| `intent_tab_selected` | Al tocar una pestaña de intención (home y `/search`). | `tab`: `all`, `eat`, `bars`, `cafes` o `desserts`. |
| `search_result_clicked` | Al tocar un lugar en `/search`. | `place_id`, `slug`.<br>`position`: el puesto en el ranking de la respuesta (los grupos conservan el puesto de la lista).<br>`surface`: `list`, o `map` para la card flotante del marcador en mobile.<br>`query`. |
| `map_zone_search` | "Buscar en esta zona". | Ninguna (la zona no se manda). |
| `results_load_more` | El scroll infinito suma la página siguiente de la lista (al acercarse al final). | `visible_count`: las cards que ya se veían.<br>`total_count`: los resultados de la búsqueda.<br>`page`: la página que se suma (2, 3…). |
| `map_marker_clicked` | Tocar un marcador del mapa de `/search`. En desktop resalta la card; en mobile abre la card flotante, y tocarla después es `search_result_clicked` con `surface: map`. | `place_id`, `slug`.<br>`position`: el puesto en el ranking. |
| `chip_removed` | Quitar un chip activo de la barra: "Abierto ahora", un sub-filtro o un extra (`tag:`, `section:`, "Cerca de"). Desmarcar algo en un select (precio, dieta, descuentos, "Dónde") sigue siendo `filter_changed`. | `filter`: `open`, `sub` o `extra`.<br>`chip`: su id (`now`, `cocktails`, `tag:groups`).<br>`from_text`: si lo había puesto el texto de la búsqueda. |

`filters` es un objeto con los tipos que tienen algo activo:
`{ location: ["near" | "all" | "zone" | "neighborhood:<ID>"], price: [...], diet: [...], open: ["now" | "today" | "tonight" | "midday" | "day"], discount: ["<banco>.<tipo>"], sub: [...], extra: ["tag:groups", "section:world", ...] }`.

Valores de `origin` (ninguno coincide con un valor de `tab`, y `events.test.ts` lo verifica):

| Valor | Qué es |
| --- | --- |
| `search_bar` | El buscador, en cualquier página (antes se llamaba `bar` y se confundía con el tab `bars`). |
| `dish` | Un plato de la home. |
| `home_row` | El "Ver todos" de una fila de la home. |
| `guide` | Un link de una guía. Hoy las guías no tienen links a búsquedas, así que no se dispara. |
| `filter` | Un filtro de la barra de la home que lleva a `/search`. |
| `intent_tab` | Una pestaña de la home que lleva a `/search` (antes se llamaba `tab`). |
| `link` | Ninguno de los anteriores: URL directa, link compartido, recarga o un link desde otra página. |

`filter` e `intent_tab` solo aparecen al llegar a `/search`: dentro de `/search` esos toques no generan
`search_submitted`. `zone` ya no existe, porque "Buscar en esta zona" solo está dentro de `/search`.

## Ficha

| Evento | Cuándo | Propiedades |
| --- | --- | --- |
| `place_viewed` | La ficha se muestra (en un efecto y visible; nunca en el render del servidor ni en el prefetch). | `place_id`, `slug`.<br>`origin`: `search`, `home`, `saved`, `similar`, `branch`, `guide` o `direct`, el de la popularidad propia.<br>`row`: el id de la fila de la home o el slug de la guía; si no, `null`. |
| `place_saved` / `place_unsaved` | El corazón de la card o "Guardar" de la ficha. | `place_id`, `slug`, `origin`. |
| `directions_clicked` | El link "Google Maps" de la ficha o la imagen del mapa en mobile (click o click del medio). | `place_id`, `slug`. |
| `share_clicked` | "Compartir". | `place_id`, `slug`.<br>`method`: `native` (menú del teléfono), `copy` ("Copiar link", o copia sin Web Share API) o `whatsapp`. |
| `external_link_clicked` | Los links de contacto. | `place_id`, `slug`.<br>`link`: `instagram`, `web` o `whatsapp`. `phone` está previsto, pero la ficha no muestra el teléfono. |
| `discount_info_clicked` | "Ver más info" de un beneficio. | `place_id`, `slug`.<br>`bank`: el id del proveedor (`itau`, `brou`…). |

## Home y guías

| Evento | Cuándo | Propiedades |
| --- | --- | --- |
| `home_row_clicked` | Un lugar de una fila de la home (también "Guardados"). | `place_id`, `slug`.<br>`row`: el id de la fila (`dinner`, `coffee`, `near`, `saved`, `discount:itau`…).<br>`position`: el puesto en la fila. |
| `home_see_all_clicked` | El título, la flecha o la card "Ver todos" de una fila. | `row`. |
| `dish_clicked` | Un plato de la home. | `dish`: el nombre que se muestra (`Pizza`). |
| `guide_viewed` | Una guía se muestra. La vista previa de borradores no cuenta. | `guide`: el slug. |
| `guide_place_clicked` | Un lugar de una guía. | `place_id`, `slug`.<br>`guide`.<br>`position`: el número del lugar en la guía. |

## Configuración

| Evento | Cuándo | Propiedades |
| --- | --- | --- |
| `location_permission` | El resultado de pedir la ubicación con el diálogo del navegador (`requestLocation`). Si falla o se vence el tiempo, no se manda. | `result`: `granted` o `denied`. |
| `welcome_completed` | La bienvenida termina con "Listo", o se cierra después de confirmar tarjetas con "Siguiente". | `cards`: las tarjetas confirmadas (`itau.credit`, `brou.debit`). Vacío si se salteó el paso 1. Nunca los lugares. |
| `welcome_skipped` | La bienvenida se cierra con "Saltear" en el último paso, Escape o el fondo, sin tarjetas confirmadas. | `step`: el paso donde se cerró (`cards` o `places`). |
