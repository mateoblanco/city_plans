# City Plans Backoffice

Herramienta local para buscar lugares de Montevideo y generar, en JSON, un borrador estructurado a partir de Google Places, resultados individuales de Exa e Instagram.

Google identifica cada resultado exactamente por `placeId`. Las otras fuentes no conocen ese identificador: la aplicación obtiene nombre, dirección y coordenadas desde Google y calcula coincidencias cercanas. Por eso esas pestañas muestran un mejor match estimado y hasta cinco candidatos auditables.

## Inicio rápido

Requiere Node.js 20 o superior.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Completá las variables de `.env.local` siguiendo las secciones siguientes y abrí la URL que informa Vite.

> Importante: una versión anterior de `.env.example` contenía una cadena con formato de API key real. Si esa clave estuvo activa, revocala y generá una nueva antes de usar la aplicación.

## Google Places

1. Creá o elegí un proyecto en [Google Cloud Console](https://console.cloud.google.com/).
2. Habilitá facturación y **Places API (New)**.
3. Creá una API key y restringila a Places API (New). Para un entorno remoto, agregá también una restricción de aplicación apropiada para el servidor.
4. Guardala únicamente en el servidor:

   ```dotenv
   GOOGLE_PLACES_API_KEY=tu_clave_de_google
   ```

La búsqueda de resultados solicita pocos campos. El botón **Buscar** usa Place Details con `X-Goog-FieldMask: *` para esta exploración. Google permite el wildcard durante desarrollo, pero lo desaconseja para producción; además puede activar el SKU de mayor costo según los campos devueltos. Revisá [Place Details](https://developers.google.com/maps/documentation/places/web-service/place-details), [campos y SKUs](https://developers.google.com/maps/documentation/places/web-service/data-fields) y [seguridad de claves](https://developers.google.com/maps/api-security-best-practices).

## Exa Web Search

La pestaña **Exa** consulta el nombre del lugar junto con `Montevideo, Uruguay` y devuelve el resultado estructurado, los grounding y hasta cinco resultados con highlights y enlaces. Cada resultado se limita a 2.000 caracteres para mantener ágil la posterior extracción. Guardá la clave sólo en el servidor:

```dotenv
EXA_API_KEY=tu_clave_de_exa
```

La consulta se ejecuta cuando abrís el detalle del lugar. Las solicitudes simultáneas de la pestaña Exa y del extractor comparten una promesa en memoria por nombre normalizado; `refresh` invalida esa caché.

## Enriquecimiento de Instagram

No se descargan páginas web ni se ejecuta Google Search. Un candidato de Instagram puede venir de una URL directa en Google Places, del campo estructurado `contact.instagram` de Exa o, como fallback, de los links de sus resultados individuales. Todos los candidatos del lugar se consultan juntos en una única ejecución de Apify.

Para obtener nombre, bio y links públicos de Instagram, creá un token dedicado en **Apify Console → Settings → API & Integrations** y agregalo únicamente al servidor:

```dotenv
APIFY_API_TOKEN=apify_api_tu_token
# Opcional; valor predeterminado:
APIFY_INSTAGRAM_ACTOR_ID=apify~instagram-profile-scraper
```

Instagram usa `apify/instagram-profile-scraper` con `includeAboutSection: false`. Sólo se acepta un perfil cuyo nombre coincida con el lugar y que tenga una señal de Montevideo/Uruguay, una dirección compatible o un enlace cruzado con la web oficial. Si hay dos perfiles válidos, ninguno se usa como evidencia.

Exa e Instagram son best-effort: si uno falla, la extracción continúa con el otro. Google Places sigue siendo obligatorio. La extracción no tiene cache ni estado en el servidor: cada llamada corre el pipeline completo.

## Logos en Cloudflare R2

Después de validar el Instagram, el pipeline toma la foto de perfil HD que ya trae Apify, la valida (imagen, mínimo 150 px, no el avatar genérico), la clasifica con un modelo chico con visión (`logo`, `local`, `food`, `person` u `other`), extrae el color de fondo y el principal y sube un WebP de 256×256 al bucket público `logos` de R2. En `places` sólo se guarda la clave; la URL pública es `LOGO_BASE_URL` + clave. Si algún paso falla, el lugar se guarda igual y el motivo queda en `review.logo`.

En Cloudflare: creá el bucket `logos`, activá el acceso público (subdominio r2.dev o dominio propio) y creá un token de R2 con permiso **Object Read & Write** sobre ese bucket. Variables (prefijo `R2_` para no mezclarlas con AWS):

```dotenv
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
R2_REGION=auto
LOGO_BASE_URL=https://pub-xxxx.r2.dev
```

`yarn logos:cleanup --dry-run` lista los logos del bucket que ninguna fila usa: los de más de 24 h (a borrar) y los más recientes (se saltean, pueden ser de extracciones sin guardar). Sin `--dry-run` borra sólo los de más de 24 h.

## Costos por extracción

La respuesta de enriquecimiento incluye `performance.costUsd`: un desglose estimado en USD de Google, Exa, Instagram/Apify, scraping, tránsito y LLM, junto con `totalUsd`. Los valores predeterminados son precios de lista para Google Place Details Enterprise + Atmosphere, Exa Search con contenido/highlights y GPT-5 mini; no descuentan topes gratuitos, créditos ni descuentos por volumen. Apify depende del actor y del plan, mientras que el scraper local y tránsito local empiezan en USD 0.

Podés ajustar cada tarifa con las variables `EXTRACTION_COST_*` de `.env.example`. Así el total refleja el precio efectivo de tu cuenta, incluidos costos propios de infraestructura si los hubiera.

## Overture Maps

No necesita cuenta ni API key. La aplicación:

- consulta el catálogo STAC para descubrir la última release;
- lee el tema `places` directamente desde los GeoParquet públicos de S3;
- limita la lectura a un bounding box de 150 metros alrededor del lugar.

La primera consulta puede demorar mientras DuckDB obtiene sus extensiones. Consultá el [quickstart de Overture](https://docs.overturemaps.org/getting-data/) y su [atribución/licencias](https://docs.overturemaps.org/attribution/).

## OpenStreetMap

Para esta prueba local se usa una instancia pública de Overpass. No requiere clave, pero sí una identificación responsable:

```dotenv
OSM_OVERPASS_URL=https://overpass-api.de/api/interpreter
OSM_USER_AGENT=CityPlansBackoffice/1.0 (contacto: tu-email@example.com)
```

La aplicación hace una consulta por interacción, mantiene una sola consulta OSM en ejecución, usa timeout y cachea resultados durante diez minutos. Las instancias públicas son comunitarias, pueden estar saturadas y no deben ser la base de una aplicación comercial o de alto tráfico. Para producción, usá una instancia propia o un proveedor administrado. Revisá la [política de instancias públicas](https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances) y la [licencia/atribución ODbL](https://www.openstreetmap.org/copyright).

## Uso

- **Barrio y categoría** conserva la búsqueda gastronómica original.
- **Texto libre** busca un lugar específico y agrega contexto de Montevideo, Uruguay.
- **Buscar por barrio** (menú lateral, `#/barrio`) recorre el polígono de un barrio de `src/lib/barrios.json` y lista todos sus lugares de comida y bebida. Ver [Recorrido por barrio](#recorrido-por-barrio).
- Cada página de Google se carga automáticamente y se deduplica en memoria por `placeId`.
- El botón **Buscar** abre la comparación. Google Details, Exa y la extracción se inician inmediatamente. Dentro de la extracción, Exa busca con el nombre que devuelve Google Details; después se solapan buses e Instagram, y el LLM comienza sin esperar a que terminen los buses.
- El matching `spatial_name_v2` compara nombres sin depender de tildes, normaliza caracteres Unicode y evalúa aliases de Overture y OpenStreetMap. Cada candidato incluye `matchEvidence` con el nombre usado y los scores parciales.
- No se guarda contenido de Google ni se agrega una base de datos. Los resultados y cachés existen solamente en memoria.

## Recorrido por barrio

`POST /api/neighborhoods/:neighborhoodId/sweep` responde en NDJSON (`start`, `progress`, `places`, `done`, `error`). Los tipos, consultas, categorías semilla y consultas de rescate se editan en `server/providers/neighborhood-sweep-config.ts`.

- Cada consulta usa Text Search con `includedType`, `strictTypeFiltering: true` y `locationRestriction.rectangle`, con hasta 3 páginas de 20.
- Si una celda devuelve 40 resultados o más (`SUBDIVIDE_THRESHOLD`; el tope de Google es 60), se divide en 4. La subdivisión es independiente para cada consulta y antes de consultar cada celda se verifica que toque el polígono.
- En celdas de 150 m que siguen saturadas se corren las consultas de rescate (`includedType: restaurant`), una sola vez por celda.
- Cada lugar se marca con `insideNeighborhood` según su ubicación respecto del polígono. Los de afuera no cuentan en los totales y quedan ocultos detrás del checkbox **Mostrar sólo lugares del barrio**, que viene marcado por defecto. Todos se deduplican por `placeId`, acumulando `seedCategories` y `foundBy`, y todas las categorías semilla llegan a la extracción.
- Hay una pausa de 300 ms entre llamadas y hasta 3 reintentos con backoff para 429 y 5xx. Si falla una página intermedia (`nextPageToken`), se reintenta una vez más tras 2 s (`PAGE_RETRY_DELAY_MS`). Las llamadas que fallan definitivamente se cuentan en el resumen (`failedCallCount` y `failedPageCount`), que muestra "Corrida incompleta: N llamadas fallidas", y el recorrido sigue.
- El costo puede ser alto (cientos de llamadas por barrio). La UI pide confirmación, permite cancelar y el servidor corta al alcanzar `NEIGHBORHOOD_SWEEP_MAX_CALLS` (1500 por defecto).
- Nada se persiste: los resultados y el resumen sólo existen en la pantalla.
- **Filtro previo al pipeline** (sólo modo completo; se edita en `server/providers/neighborhood-sweep-config.ts`, clasifica `server/providers/place-prefilter.ts`): cada lugar queda en `rejected` (cerrado temporal o permanentemente, o `primaryType` en `REJECT_PRIMARY_TYPES`), `accepted` (`primaryType` en `ACCEPT_PRIMARY_TYPES` o terminado en `_restaurant`) o `review` (`primaryType` en `REVIEW_PRIMARY_TYPES` con motivo `review_type:<tipo>`, en ninguna lista con motivo `unknown_type:<tipo>`, sin `primaryType`, o con menos de 10 reseñas: `MIN_REVIEWS_TO_ACCEPT`). El orden es: cerrado, REJECT, REVIEW, ACCEPT, y cualquier otro; manda el `primaryType`, no los `types` secundarios. El resumen lista los tipos desconocidos con su cantidad para pasarlos a una de las dos listas. El campo `reason` explica el motivo. La tabla tiene una pestaña por grupo y sólo los aceptados tienen el botón **Buscar**. `rating` y `userRatingCount` sólo se muestran en las vistas previas del resumen y no se guardan; el rating no clasifica y la cantidad de reseñas sólo decide `few_reviews`.
- Hay dos modos (`{ "mode": "full" | "ids" }` en el body):
  - **Completa** (`full`, el modo por defecto) trae nombre, tipos, ubicación, `businessStatus`, `primaryType`, `rating` y `userRatingCount`, y filtra por polígono. Por `rating` y `userRatingCount` se factura como Text Search Enterprise (USD 35 cada 1.000 llamadas, 1.000 gratis por mes).
  - **Sólo IDs** (`ids`) pide `places.id,nextPageToken`, que se factura como Text Search Essentials (IDs Only) y es [gratis e ilimitado](https://developers.google.com/maps/billing-and-pricing/pricing). Sirve para probar el recorrido y estimar cuántos lugares hay. Como no trae ubicación, no se puede filtrar por polígono: el conteo puede incluir lugares de barrios vecinos, y la tabla no ofrece **Buscar**.

## Procesamiento por lote

`POST /api/extract` recibe **un** lugar (`{ googlePlaceId, seedCategories, neighborhoodId? }`), corre el pipeline y responde con el resultado final y `performance` (`totalMs` y `stepsMs` por paso), o con el envelope de error. Si falta `neighborhoodId`, se calcula con las coordenadas. No hay jobs, polling, archivos ni estado en el servidor. Es el único endpoint de extracción; también lo usa el diálogo **Buscar**.

- En el servidor, Apify, Exa y el LLM tienen límites de concurrencia compartidos entre requests (`p-limit`, `server/providers/service-limits.ts`): 2, 3 y 3 por defecto, configurables con `EXTRACT_LIMIT_APIFY`, `EXTRACT_LIMIT_EXA` y `EXTRACT_LIMIT_LLM`.
- En **Buscar por barrio** se seleccionan lugares de **Aceptados** y **Para revisar**. **Procesar (N)** los recorre con `p-map` (`EXTRACT_CONCURRENCY = 3` en `src/lib/extraction-config.ts`), cada uno con su propia request.
- Cada fila pasa por En cola → Procesando… → Listo (con duración) o Error (con el mensaje). Una falla no corta las demás, y **Reintentar fallidos** vuelve a correr sólo esas.
- Cada fila procesada tiene **Ver resultado**, que abre un modal con el JSON final (la misma vista que la pestaña Info del diálogo) o el error, sin volver a llamar al pipeline. Al terminar el lote se muestran el tiempo total, el promedio por lugar, el promedio por paso y la cantidad de listos y con error.
- Los resultados viven sólo en el estado de React: se pierden al salir de la pantalla. Cada lugar procesado consume Google Details (`*`), Exa, Apify y el LLM; el costo estimado viene en `performance.costUsd`.

## Validación

```bash
npm test
npm run lint
npm run build
```

El estado de configuración se puede consultar en `GET /api/health`; la respuesta informa booleanos para Google, Exa, Instagram y extracción (además de los proveedores geográficos disponibles) y nunca devuelve secretos.
