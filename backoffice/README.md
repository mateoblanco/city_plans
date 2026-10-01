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

Exa e Instagram son best-effort: si uno falla, la extracción continúa con el otro. Google Places sigue siendo obligatorio. Los resultados se cachean sólo en memoria durante la ejecución del servidor.

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
- Cada página de Google se carga automáticamente y se deduplica en memoria por `placeId`.
- El botón **Buscar** abre la comparación. Google Details, Exa y la extracción se inician inmediatamente. En el servidor, Google y Exa corren en paralelo; después se solapan buses e Instagram, y el LLM comienza sin esperar a que terminen los buses.
- El matching `spatial_name_v2` compara nombres sin depender de tildes, normaliza caracteres Unicode y evalúa aliases de Overture y OpenStreetMap. Cada candidato incluye `matchEvidence` con el nombre usado y los scores parciales.
- No se guarda contenido de Google ni se agrega una base de datos. Los resultados y cachés existen solamente en memoria.

## Validación

```bash
npm test
npm run lint
npm run build
```

El estado de configuración se puede consultar en `GET /api/health`; la respuesta informa booleanos para Google, Exa, Instagram y extracción (además de los proveedores geográficos disponibles) y nunca devuelve secretos.
