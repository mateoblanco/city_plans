# Imagen para compartir (Open Graph) de la ficha

Sin commit: queda todo en el árbol de trabajo para que lo pruebes. `PlaceCard.module.scss` no se tocó.

## Qué se hizo

**Ficha (`/place/<slug>`)**: una imagen de 1200 × 630 generada con `ImageResponse`:
- Fondo blanco, una banda de 378 px (60 %) a todo el ancho con `logo_bg_color`, el mismo dato que usa la banda de la ficha (`PlaceHeader`).
- Recuadro centrado de 470 × 470, borde de 20, radio de 50 afuera y 30 adentro, y una sombra suave hacia abajo. Pisa la banda y el blanco. Usé las medidas tal cual, como acordamos.
- Adentro va el logo sobre su color, con la misma proporción logo/recuadro que la ficha en desktop (364 px de lado máximo).
- Si la banda es blanca o casi blanca, el borde pasa al gris de la app (`--color-border`), como hace la ficha con `isNearWhite`.
- **Sin logo** (o si el logo no carga): la banda con el azul de la marca y el nombre en Switzer 600 (la tipografía del nombre en `PlaceImage`), centrado. El tamaño baja de 72 a 36 según el largo, con un máximo de 3 líneas, y si no entra corta con "…" entre palabras.
- **Logo sin color en la base** (37 lugares): banda negra (`#000000`, el negro de la paleta) y recuadro blanco. En la ficha esos lugares no tienen banda; acá hace falta una. El azul queda sólo para los lugares sin logo.
- Sin texto, sin marca y sin datos de Google.

**Metadata de la ficha**: `og:image` con la URL absoluta del dominio principal (`https://www.adondevamos.com.uy/place/<slug>/og/<versión>`), `og:image:type` `image/jpeg`, ancho, alto, `og:image:alt` "Logo de <nombre>", `twitter:card` `summary_large_image` y `twitter:image` con lo mismo.

**Resto de las páginas**: usan tu `src/app/opengraph-image.jpg` (2400 × 1260, 32 KB). Esa ruta es la correcta: un archivo en la raíz de `app` aplica a todas las páginas. Por página:
- Home y `/search` la heredan solas.
- Las guías (`/guides/montevideo`, cada guía y las páginas de barrio) definen su propio `openGraph`, y eso les hace perder la heredada. Por eso la llevan explícita con `DEFAULT_OG_IMAGE` de `src/lib/site.ts`, que tiene la URL y las medidas del .jpg (un test verifica que coinciden con el archivo).
- Todas llevan `summary_large_image`.
- La home dejó de usar `public/og-home.jpg`. El archivo sigue ahí, no lo borré.
- Alt de la imagen por defecto: "Logo de A Dónde Vamos", en `src/app/opengraph-image.alt.txt` (para la home y `/search`) y en `DEFAULT_OG_IMAGE` (para las guías, armado con `SITE_NAME`). El .txt es texto fijo y no puede leer `SITE_NAME`: un test exige que coincida con `` `Logo de ${SITE_NAME}` ``, así que si cambia el nombre del sitio, el test falla.

## Desvío de lo pedido: no es el file convention `opengraph-image`

Lo armé con `opengraph-image.tsx` + `generateImageMetadata`, que es lo que da el alt por lugar y la versión en la URL. **En producción respondía 500.** El motivo:
- Con `generateImageMetadata`, Next le genera a la ruta un `generateStaticParams` (`next-metadata-route-loader.js`).
- Con `cacheComponents`, una ruta así no puede leer la base por pedido ("used IO that was not cached"). `connection()` no lo arregla, y `dynamic` / `dynamicParams` no existen con `cacheComponents`.
- La variante sin `generateImageMetadata` sí funciona, pero pierde el alt por lugar y la versión en la URL, y sin versión no se puede cachear para siempre.

Por eso quedó como un Route Handler común, `src/app/place/[slug]/og/[version]/route.tsx`. Sigue usando `ImageResponse`, y la ficha declara la imagen en su `generateMetadata`. Si preferís el file convention igual, se puede, a cambio de un alt fijo y una caché por tiempo en vez de por versión.

## Tipografía sin subir la fuente al repo

Al generar una imagen sin logo, el servidor pide el CSS de Fontshare (`api.fontshare.com/v2/css?f[]=switzer@600`), toma la URL del `.ttf` y lo baja de `cdn.fontshare.com`, con un timeout de 3 s (`src/server/og/font.ts`):
- Se guarda en memoria de la instancia, una vez por instancia. Como las imágenes quedan en la CDN, se baja muy pocas veces.
- No entra al repo ni al build, no se subsetea ni se convierte a otro formato. Es lo mismo que hace el navegador en cada visita. Ésta es mi lectura de la licencia (ITF FFL), no una opinión legal.
- Si Fontshare falla, el nombre sale con la fuente que trae `ImageResponse` y la imagen se guarda sólo 5 minutos, para reintentar. Nunca un error.

## Logo

- Los logos de R2 son WebP y Satori no lee WebP. `src/server/og/logo.ts` los baja (timeout 3 s, tope 2 MB, sólo `image/*`) y los pasa a PNG con **sharp**, que agregué como dependencia directa (`0.35.5`, la misma versión que ya traía Next).
- Cualquier falla (no responde, 404, no es una imagen, archivo roto) da la versión sin logo con caché corta. Nunca una imagen rota ni un 500.

## Caché

- La URL lleva una versión: un hash de logo, color, nombre y `OG_DESIGN_VERSION`. Cambia sólo si cambia alguno de esos datos.
- Cada URL sale con `Cache-Control: public, immutable, max-age=31536000` y `CDN-Cache-Control: public, max-age=31536000`. Se genera una vez por lugar y versión, y la guarda la CDN de Vercel.
- Una versión vieja de la URL devuelve la imagen actual, pero con caché de 5 minutos. Una ficha no publicada da 404.
- Si se cambia el diseño, hay que subir `OG_DESIGN_VERSION` en `src/server/og/model.ts`.
- No hay ninguna llamada a Google.
- Tu `.jpg` por defecto la sirve Next como archivo estático (`max-age=0, must-revalidate` en local; en Vercel la sirve la CDN).

## Peso: pasé la salida a JPEG

Satori sólo saca PNG, y con logos tipo foto el PNG pesaba hasta **417 KB** (23 fichas pasaban de 300 KB). Ahora se dibuja igual y sharp la convierte a JPEG calidad 90, sin submuestreo de color. Si la conversión falla, sale el PNG con caché corta.

Medido contra el build de producción local, con **las 778 fichas publicadas**:

| | Resultado |
|---|---|
| Errores / versiones degradadas | 0 / 0 |
| Más pesada | 71 KB (ipanema-siam) |
| Mediana / p95 | 26 KB / 50 KB |
| Más de 300 KB | 0 |

## Capturas

En `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans/ea9e56be-2f47-4d76-9181-e35b65c58d89/scratchpad/og/`:

| Caso | Archivo | Peso |
|---|---|---|
| Logo claro (banda blanca, borde gris) | `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans/ea9e56be-2f47-4d76-9181-e35b65c58d89/scratchpad/og/anastasia.jpg` | 24 KB |
| Logo oscuro | `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans/ea9e56be-2f47-4d76-9181-e35b65c58d89/scratchpad/og/no-tan-santos.jpg` | 22 KB |
| Logo con fondo transparente, con color | `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans/ea9e56be-2f47-4d76-9181-e35b65c58d89/scratchpad/og/transparente-con-color.jpg` | 34 KB |
| Logo con fondo transparente, sin color | `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans/ea9e56be-2f47-4d76-9181-e35b65c58d89/scratchpad/og/transparente-sin-color.jpg` | 27 KB |
| Sin logo, nombre largo | `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans/ea9e56be-2f47-4d76-9181-e35b65c58d89/scratchpad/og/restaurante-club-pescadores-de-montevideo.jpg` | 25 KB |
| Logo sin color (es una foto) | `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans/ea9e56be-2f47-4d76-9181-e35b65c58d89/scratchpad/og/brote-cocinaintuitiva.jpg` | 46 KB |
| La más pesada (logo tipo foto) | `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans/ea9e56be-2f47-4d76-9181-e35b65c58d89/scratchpad/og/la-maestranza.jpg` | 67 KB |

**En R2 no hay ningún logo con transparencia.** Revisé los 743: todos son opacos, porque el backoffice los guarda así. Las dos capturas de transparencia usan un logo de prueba (un WebP con alfa) que pasa por el mismo camino: la transparencia se conserva y el logo queda sobre su color, o sobre el recuadro blanco si no tiene color, como en la ficha.

En el logo oscuro, el rectángulo blanco alrededor de "No Tan Santos" es parte del archivo del logo, no de la imagen.

## Falta: WhatsApp y validador

**No lo pude probar.** Hace falta una URL pública, y sin commit no hay preview: no hay CLI de Vercel ni túnel instalados. Lo que sí verifiqué fueron las meta tags en el HTML con el user agent de WhatsApp, en la ficha, la home, `/search`, la ciudad y una guía.

**Un preview o un túnel no alcanzan:** la og:image siempre apunta al dominio principal (`SITE_URL` es fijo también en local y en previews), y ese dominio no tiene la ruta nueva hasta el deploy a producción. El validador vería la página pero la imagen le daría 404. Para probar en un preview haría falta que `metadataBase` use `VERCEL_URL` en previews (no está hecho). Para probarlo después del deploy a producción:

1. Pegar la URL de una ficha en https://www.opengraph.xyz o en el Sharing Debugger de Facebook (https://developers.facebook.com/tools/debug/, que es el que usa WhatsApp). Tendría que verse la imagen de 1200 × 630 con su alt.
2. Mandar el link por WhatsApp a un chat propio. WhatsApp cachea la vista previa por URL, así que si ya se compartió antes, probar con `?v=1` al final.
3. Repetir con la home y una guía (tu .jpg).

## Tests, tipos y lint

- `yarn test`: 1803 en verde. Los nuevos están en `src/server/og/test/` y `src/lib/test/og-image.test.ts`:
  - URL absoluta en la metadata, alt, medidas, tipo y `summary_large_image` (ficha y guías).
  - Versión sin logo (sin logo, o con el logo que falla: rechazo, 404, no imagen, archivo roto).
  - Nombre largo: 3 líneas, "…", palabra sin espacios.
  - Sin Google: el cliente de Places mockeado para que falle si alguien lo importa, más una revisión del código de la imagen.
  - Además: versión estable y que cambia sólo con logo, color o nombre; caché larga, corta y 404 en la ruta; fuente de Fontshare (sólo pide a sus dos hosts, `null` si falla, reintenta); WebP → PNG del tamaño correcto; medidas del .jpg por defecto.
- `tsc --noEmit` y `yarn lint`: sin errores.
- `yarn build`: OK.

## Archivos

- Nuevos:
  - `src/server/og/`: `model.ts`, `frame.tsx`, `logo.ts`, `font.ts`, `place-image.tsx` y los tests.
  - `src/app/place/[slug]/og/[version]/route.tsx`.
  - `src/lib/test/og-image.test.ts`.
- Cambiados:
  - `src/app/place/[slug]/page.tsx`
  - `src/app/page.tsx`
  - `src/app/layout.tsx` (`twitter.card` por defecto)
  - `src/app/guides/montevideo/page.tsx`
  - `src/server/guides/metadata.ts`
  - `src/lib/site.ts` (`DEFAULT_OG_IMAGE`)
  - `package.json` y `yarn.lock` (sharp)
- Tuyos, sin tocar: `src/app/opengraph-image.jpg` y `DEPLOY.md`.
- `AGENTS.md`: actualicé el punto de Open Graph de la sección SEO (cómo es la imagen, por qué es un Route Handler, la caché, el peso, la fuente y la imagen por defecto).
- También nuevo: `src/app/opengraph-image.alt.txt`.
- Deploy: no hace falta ninguna variable nueva (usa `LOGO_BASE_URL`, que ya existe) ni ninguna migración.
