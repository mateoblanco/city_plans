# City Plans Backoffice

## Objetivo

Backoffice local para buscar lugares de Montevideo mediante Google Places API (New) y comparar sus datos con Overture Maps y OpenStreetMap. Consulta y muestra resultados; lo único que persiste es el borrador del pipeline de extracción en Neon (`POST /api/places`). No edita ni exporta contenido.

## Arquitectura

- `src/`: Vite, React, TypeScript, Tailwind CSS y componentes shadcn/ui.
- `server/`: API local Hono sobre Node. Es la única capa autorizada a leer la clave de Google.
- `src/data/`: barrios permitidos y snapshot tipado de categorías Food and Drink.
- `../shared/`: `tags.ts`, `neighborhood-names.ts`, alias y centros de barrios, compartidos con la app de Next. `src/data/tags.ts` y `src/data/neighborhood-names.ts` sólo los reexportan. `shared/neighborhood-centroids.json` se regenera con `yarn tsx server/scripts/neighborhood-centroids.ts`.
- `PlacesProvider`: límite entre el dominio y cada fuente externa. Mantener Google encapsulado en su provider.
- `POST /api/places/search`: acepta el modo controlado de barrio/categoría o texto libre acotado a Montevideo, más un token opaco de paginación.
- `POST /api/neighborhoods/:neighborhoodId/sweep`: recorrido adaptativo (quadtree) de un barrio de `barrios.json`, en NDJSON. Configuración en `server/providers/neighborhood-sweep-config.ts`; resultados sólo en memoria, con tope `NEIGHBORHOOD_SWEEP_MAX_CALLS`.
- La UI tiene menú lateral: **Buscar lugares** (`#/`), **Buscar por barrio** (`#/barrio`) y **Lugares** (`#/lugares`, sólo lectura de lo guardado en Neon).
- `POST /api/extract`: único endpoint de extracción, un lugar por request (`{ googlePlaceId, seedCategories, neighborhoodId? }`), sin cache ni estado. Todas las `seedCategories` quedan en `categories`. Apify, Exa y el LLM tienen límites `p-limit` compartidos (`server/providers/service-limits.ts`); el lote del frontend usa `p-map` con `EXTRACT_CONCURRENCY`.
- Los detalles Google se consultan una sola vez por `placeId`; las otras fuentes hacen matching espacial y textual desde ese ancla.
- `POST /api/places` (`{ results }`): guarda resultados de `/api/extract` en la tabla `places` de Neon (`server/db/`, Drizzle) vía `server/places/save.ts`. Valida cada place con `PlaceDraft`, respeta `manualOverrides` al actualizar y calcula embeddings (`openai/text-embedding-3-small` por el AI Gateway) sólo cuando cambia el hash de `embeddingText`. `GET /api/places/exists?ids=` devuelve los `googlePlaceId` ya guardados. `GET /api/places` (`server/places/list.ts`) lista los lugares guardados por `updatedAt` descendente, sin `embedding` ni textos de búsqueda. Sin `DATABASE_URL` responden 503.
- Búsqueda en `places`: `embeddingText` describe la identidad (nombre, barrio, `locatedIn`, `description.es` y labels de categories, cuisines, atmosphere, goodFor y `signature`), sin listas de platos. `keywordText` suma todos los tags con sinónimos, highlights y `dishes`. `dishes` (platos respaldados por un fact, máx. 15) y `signature` (hasta 3 ids que también están en `tags`) son `text[]` con índice GIN. `search_tsv` pesa el nombre como `A` y `keyword_text` como `B`.
- El schema del LLM (`PlaceExtraction` en `server/providers/place-extraction-service.ts`) está al límite de la gramática de salida estructurada de Anthropic ("The compiled grammar is too large"): hoy no entra ni un campo más de primer nivel sin simplificar otro. Convención: los strings opcionales van como `z.string()` con `""` = sin dato (nunca `.nullable()`), y `postProcess` los convierte a `null`; sin enums de ids, `.max()` ni regex: se validan en el código.
- El `name` de un lugar es la marca, sin sucursal: `brandFromGoogleName` (`server/providers/brand-name.ts`) le saca al nombre de Google los sufijos de barrio, shopping, "sucursal", etc. y `postProcess` lo guarda si alguna fuente lo nombra (el resumen de Exa no cuenta). Exa, Instagram y la web oficial también se buscan con la marca. La sucursal no va en `name`: la UI la arma con `neighborhoodId` o `locatedIn`. En una sucursal de cadena (`isChainBranch`: la marca no es el nombre de Google o alguna fuente muestra varias sucursales), horario, teléfono, WhatsApp, dirección y features físicos sólo se aceptan de fuentes que mencionan la dirección o el barrio del local (el resumen de Exa no cuenta); sin horario queda `missingReason: 'chain_branch_not_found'`. El resto (web, Instagram, categorías, platos, descripción, dieta, precio) es de la marca.
- Tags de FEATURES, GOOD_FOR, OFFERS y ATMOSPHERE: necesitan un fact que no sea del resumen de Exa (FEATURES, GOOD_FOR y ATMOSPHERE, además, que lo nombre con su label o un sinónimo). Si el modelo sólo citó el resumen, el código busca el label o un sinónimo en las fuentes reales y, si aparece, agrega un fact `C<n>` con esa línea como respaldo. `delivery` también se agrega si hay una página del local en Rappi o PedidosYa.
- Teléfonos: siempre con `libphonenumber-js/max`, validados como fijo o celular de Uruguay (nunca regex). Las páginas de Exa de otros países (`isForeignSource`: dominio extranjero o dirección extranjera sin mención de Uruguay) no entran como fuentes. Instagram: los candidatos salen también de una búsqueda dirigida en Exa (`<marca> Montevideo instagram`) y de cualquier `@handle` del resumen de Exa, pero todos pasan por la validación con Apify.
- Las búsquedas por nombre tienen que comparar contra `f_unaccent(lower(name))` (por ejemplo `f_unaccent(lower(name)) % f_unaccent(lower($1))` o `ILIKE`) para que Postgres use el índice trigram `places_name_trgm_idx`.

## Comandos

- `npm run dev`: frontend y API local.
- `npm run build`: typecheck y build del frontend.
- `npm run lint`: análisis estático.
- `npm test`: suite Vitest.

## Reglas

- Nunca exponer `GOOGLE_PLACES_API_KEY` al cliente, usar variables `VITE_*` para ella ni incluirla en logs o respuestas.
- Validar el texto libre, limitarlo a 2–200 caracteres y agregar el contexto geográfico de Montevideo en el provider.
- Mantener todos los textos de interfaz en español y los identificadores de Google en inglés.
- La búsqueda solicita solamente los campos que la tabla necesita. Place Details usa `*` únicamente al presionar **Buscar**, con advertencia visible en la documentación por costo.
- No almacenar contenido de Google Places: de Google, el borrador del pipeline en `places` sólo guarda `googlePlaceId` y `location` (con `coordinatesFetchedAt`). Nombre, dirección, teléfono y web salen de las fuentes con su fact; los de Google sólo sirven para buscar. Sin nombre confirmado, el lugar no se guarda. Búsquedas, recorridos, detalles crudos y la deduplicación siguen sólo en memoria por `placeId`.
- Conservar la atribución visible de Google Maps junto a sus resultados.
- Encapsular cada fuente en su provider. La tabla usa `PlaceSummary`; la exploración conserva el JSON externo dentro de un envelope común auditable.
- Cualquier cambio funcional debe cubrir estados inicial, carga, vacío, éxito, error inicial y error parcial.

## Fuera del MVP

Autenticación, edición, mapas, exportación, búsquedas masivas fuera de un único barrio y catálogo multi-fuente persistente. La cuadrícula geográfica existe sólo para el recorrido de un barrio, con confirmación de costo y sin persistencia.
