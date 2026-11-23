# Guías, tanda 2: candidatos desde una idea y textos con IA

Nada está commiteado. No toqué `search-href.ts`, `labels.ts` ni `PlaceCard.module.scss`. La app no cambió: todo es del backoffice, salvo `slugify` en `shared/guides.ts`.

## Qué hay que hacer antes de probar

1. **Migración `0028_guide_ai_cost`** (backoffice, `yarn db:migrate`).
   - Suma `guides.ai_cost_usd`. No la corrí.
   - Sin ella, el editor falla al leer una guía, porque la consulta ya pide esa columna.
   - La `0027` (tanda 1) también tiene que estar corrida.
2. **`APP_URL`** en el `.env` del backoffice: la app tiene que estar corriendo ahí para "Buscar lugares" (`next dev` local o la URL de producción).
3. **`AI_GATEWAY_API_KEY`** (ya la tenés) con crédito.
   - `GUIDES_MODEL` es opcional. Por defecto, `anthropic/claude-opus-5.5`.
   - Las dos están en `.env.example`.

## 1. Candidatos desde una idea

**Cómo se reusa el motor:** el servidor del backoffice llama al `GET /api/search` público que ya tiene la app. No hay código duplicado ni ruta nueva en la app.

**Qué manda:**
- `q` = la idea;
- `intent` = el grupo de la guía;
- `f=neighborhood:<id>` si la guía es de un barrio; sin barrio, es toda la ciudad;
- siempre `loc=all` y `profile=off`;
- **nada de la persona:** el pedido sale del servidor sin cookies, así que no hay ubicación ni guardados. No va ningún `open:*` ni otro filtro de horario, ni `remove`, `sub` o `debug`. Lo cubre `candidates.test.ts`.

**Páginas:** `/api/search` no pagina.
- Devuelve en `results` todos los que pasan el corte por relevancia; la app los muestra de a 12 sólo en el cliente.
- Con un pedido alcanza: tomo los primeros 30 (`CANDIDATES_MAX`).
- Si el motor devuelve menos, son todos los que encontró.
- No uso "Cerca de <barrio>" (`nearby`, fuera del barrio) ni "Para vos".

**Motivos:** la API ya los devuelve (`reasons`, hasta 3 por lugar) y se muestran tal cual: "Por qué apareció: Para trabajar · Café de especialidad".

**Lo que no trae la búsqueda:** tags y descripción. Salen de la base del backoffice, en una consulta por ids.

**En el editor**, la sección **"Buscar candidatos"** va arriba de "Lugares":
- campo "Idea" y botón "Buscar lugares";
- cada candidato muestra logo (o el ícono), nombre, barrio, tipo, hasta 6 tags, la descripción corta y por qué apareció;
- los que ya están en la guía quedan marcados "En la guía";
- "Agregar" lo suma al final, como agregarlo por nombre.

**Probado de verdad** contra la app local, con "cafés tranquilos para trabajar", Cordón y Cafés:
- volvieron **9 candidatos** en ~2 s;
- es todo lo que pasó el corte, no un tope;
- entre ellos, Inocencio, Sauco, Escaramuza, La Fábrica y Cardenal, con sus motivos.

## 2. Textos con IA

**Modelo:** `anthropic/claude-opus-5.5`, el Opus más nuevo del AI Gateway (lo confirmé en su lista de modelos).
- Cuesta US$ 4 / 20 por millón de tokens de entrada / salida.
- El precio quedó en `LLM_PRICES_PER_MILLION` como respaldo. El costo que se muestra es el real que devuelve el Gateway.
- Se cambia con `GUIDES_MODEL`.

**Botones**, cada uno generar o regenerar por separado:
- título visible;
- título y descripción para Google (los dos juntos);
- introducción;
- texto de cada lugar;
- "Generar los textos vacíos": una llamada por lugar, 3 a la vez, que nunca pisa uno que ya escribiste, aunque lo hayas escrito mientras generaba;
- en Introducciones, la de la ciudad y la de cada barrio.

**Nada se guarda ni se publica solo.** Lo generado se carga en el campo y queda "Cambios sin guardar". Lo único que se escribe en la base es el costo.

**Slug sin IA:** `slugify(título)`: minúsculas, sin tildes, ñ → n, guiones y hasta 80 caracteres.
- Mientras la guía nunca se publicó, el slug sigue al título; también cuando el título lo genera la IA.
- Si lo editás a mano, deja de seguirlo.
- Publicada una vez (`published_at`), queda fijo, con el aviso "Fijo: la guía ya se publicó (cambiarlo rompe los links)". Se puede cambiar a mano.

## 3. Tono: `backoffice/config/guide-style.md`

Es un primer borrador para que lo ajustes:
- **Voz:** cercana y uruguaya, con voseo; concreta.
- **Qué evitar:** superlativos, "imperdible", "joya escondida", clichés de folleto, emojis, signos de exclamación, precios, horarios, direcciones y comparaciones.
- **Largos:** los de cada texto.
- **Ejemplos:** tres (un título, una intro y el texto de un lugar), sacados de la guía de Cordón.

Todos los prompts lo leen en cada generación, así que un cambio vale para la próxima sin reiniciar. Lo que esté entre `<!-- -->` es una nota para vos y no va al modelo.

## 4. Que no invente

**Lo que recibe el modelo de cada lugar** (`placeFacts`, lista cerrada `PLACE_FACT_KEYS`; todo sale de `places`, con labels en español y nunca ids):

| Clave | De dónde sale |
|---|---|
| nombre | `name` |
| barrio | `neighborhood_id`, con el nombre que se muestra |
| dentro_de | `located_in` |
| tipo | labels de `categories` |
| descripcion | `description_es` |
| conocido_por | `highlights[].es` y labels de `signature` |
| platos | `dishes` |
| ambiente, para_que, comidas, bebidas, cocinas, servicios, ofertas | labels de `tags`, por su grupo |
| estilo | `style`: casual, intermedio o cuidado |
| precio | `price`, como palabra fija: "económico", "precio medio" o "caro" (sin precio, no va) |
| dietas | vegano, vegetariano o sin TACC, con "todo el menú" o "tiene opciones" |

- **No recibe:** horarios, reservas, Instagram, web, seguidores, prominencia, cadena o marca, logo, coordenadas, dirección ni nada de Google.
  - La consulta (`PROMPT_PLACES_SQL`) ni siquiera lee esas columnas.
  - Además, `placeFacts` descarta todo lo que no esté en la lista.
- **Precio:** sólo como palabra fija; nunca el id ni un monto (ver "Ajustes después de la primera revisión").
- **Datos vacíos:** un dato vacío no va. Con 4 datos o menos, el prompt pide una sola oración.
- **Intros de barrio y de ciudad:** reciben el nombre, las guías publicadas (título y grupo), la cantidad de lugares publicados y los tipos y tags más comunes entre ellos. La de la ciudad recibe además los barrios con guías.
- **Prompt:** "Usá SÓLO los datos que te paso. No agregues nada de tu conocimiento propio…", más las prohibiciones.
- **Validación:**
  - Las respuestas se validan con zod (`Output.object`).
  - Después, `groundingIssues` rechaza:
    - siempre: montos y comparaciones de precio;
    - un horario o una palabra de precio que no esté en los datos;
    - sólo en el texto de cada lugar y en las introducciones: superlativos y comparaciones que no estén en los datos.
  - En los dos casos responde 422 con un mensaje claro ("El texto generado menciona un monto, que no se permite o no está en los datos. Volvé a generar.") y **no carga nada**.
- **Costo de lo rechazado:** una respuesta inválida se cobra igual, así que su costo se suma y el error lo dice.

## 5. Costo y errores

- **Sin crédito:**
  - Al abrir el editor se consulta el saldo con `gateway.getCredits()`. Con saldo 0 aparece el aviso con el link "Cargar crédito" y los botones de IA quedan apagados antes de generar.
  - Si igual llega un 402, aunque venga envuelto en otro error, el mensaje sale con el mismo link: `https://vercel.com/d?to=/[team]/~/ai`. Es el mismo formato de link que usa el AI SDK para las claves.
  - Si la consulta del saldo falla, no se bloquea nada.
- **Costo:**
  - Al lado de cada botón va el costo de la última generación.
  - Al pie del editor va "Gastado en IA en esta guía: US$ …", el modelo y el crédito del Gateway.
  - El total se guarda en `guides.ai_cost_usd` e incluye las generaciones descartadas.
  - Lo que se genera en una guía nueva todavía sin guardar se suma al crearla.
  - Las intros de barrio y de ciudad no son de una guía: muestran el costo de cada generación y el total de la sesión.
- **Medido:** el texto de un lugar costó **US$ 0,0093** en la prueba real (abajo). Una guía de 9 lugares con todos los textos anda por ~US$ 0,15.

## Prueba real

Desde un script, sin escribir en la base: la búsqueda contra la app local y una generación con Opus.

Datos que recibió el modelo de Inocencio Café:

```
nombre: Inocencio Café
barrio: Cordón
tipo: Café
descripcion: Cafetería acogedora en el Cordón, con ambiente tranquilo y buen wifi, ideal para ir a trabajar con la compu. …
conocido_por: Café; Sándwich caliente; Para trabajar; Acogedor
platos: sándwich caliente
ambiente: Acogedor
para_que: Para trabajar; Cita; Desayuno; Merienda; Almuerzo; Cena
comidas: Sándwiches; Panificados
bebidas: Café de especialidad
servicios: Wifi
estilo: Intermedio
```

Texto generado:

> Cafetería tranquila y acogedora, con buen wifi para abrir la compu y quedarte laburando. Sirven café de especialidad y, si se alarga la jornada, podés acompañar con un sándwich caliente o algo de panificados.

Costo: US$ 0,0093. No menciona nada fuera de los datos.

## Tests

**Backoffice: 92 archivos y 1136 tests OK.** `tsc -b` y `oxlint` limpios. La app no cambió y `tsc` pasa.

- **`server/guides/candidates.test.ts`:**
  - la URL lleva barrio y grupo, `loc=all` y `profile=off`, sin horario ni nada de la persona;
  - toda la ciudad va sin `f`;
  - corta en 30 e ignora `nearby`;
  - suma tags y descripción;
  - sale sin cookies;
  - sin `APP_URL`, 503; la app caída o con error, 502.
- **`server/guides/prompts.test.ts`:**
  - **campos permitidos:** con un lugar de prueba que tiene *todas* las columnas de `places` (precio, horario, Instagram, web, seguidores, coordenadas, `google_place_id`, textos de búsqueda, overrides…), `placeFacts` sólo tiene claves de la lista;
  - el prompt armado no contiene ningún valor prohibido ni ids internos;
  - un dato vacío no aparece;
  - el system lleva la guía de estilo sin los comentarios.
- **`server/guides/generate.test.ts`:**
  - `groundingIssues` atrapa horario, precio, superlativo y comparación, y deja pasar lo que dicen los datos;
  - una salida que no pasa el schema da error con el costo pagado;
  - se reconoce el 402, también envuelto;
  - en la ruta: el borrador vuelve sin guardar y el costo se suma a la guía;
  - **error 402** con el link;
  - 422 sin valor pero con el costo sumado;
  - "generar los vacíos" saltea los que tienen texto y aguanta un error parcial;
  - 503 sin generador y 422 sin lugares;
  - la intro de barrio sale con los datos del barrio;
  - `ai-status` devuelve el saldo y el link.
- **`server/guides/store-db.test.ts`** (PGlite, con la 0027 y la 0028):
  - el costo se acumula;
  - los datos para el prompt salen en orden y sin columnas prohibidas;
  - los datos del barrio.
- **`src/data/guides.test.ts`:** slug con tildes y ñ ("Cafés con ñandú en Peñarol" → `cafes-con-nandu-en-penarol`), signos y corte a 80.
- **`src/components/guide-editor.test.tsx`:**
  - **candidatos con barrio y grupo aplicados**, los que ya están marcados y "Agregar" al final;
  - **el slug sigue al título** en un borrador, deja de seguirlo si se edita a mano y **queda fijo en una publicada**;
  - lo generado se carga sin guardar, con su costo y el total;
  - el título generado mueve el slug;
  - **validación:** error sin cargar nada;
  - **402** con el link y los botones apagados;
  - "generar los vacíos" no pisa lo escrito;
  - saldo 0 antes de generar.

## Capturas (backoffice, con la API mockeada)

Los textos de la segunda captura son de ejemplo; el de Inocencio es el que generó Opus en la prueba real.

- Editor buscando candidatos (2 ya en la guía y 2 recién agregados): `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans/9d3a7bca-d9b1-4901-ac8f-41d53f48afb5/scratchpad/guias-candidatos.png`
- Editor con textos generados, el costo de cada botón, un error parcial y el total: `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans/9d3a7bca-d9b1-4901-ac8f-41d53f48afb5/scratchpad/guias-textos-generados.png`

## Ajustes después de la primera revisión

1. **Superlativos y comparaciones** se chequean sólo en el texto de cada lugar y en las introducciones (de la guía, del barrio y de la ciudad).
   - En el título visible y en lo de Google se permiten, y el prompt y la guía de estilo lo dicen: "Los mejores chivitos de Montevideo".
   - Esto incluye la descripción para Google, que también quedó sin ese chequeo porque lo pediste sólo para lugares e introducción. Si la querés controlada como las intros, es una línea.
   - Montos, comparaciones de precio y horarios se siguen rechazando en todos los textos, también en los títulos.
2. **Precio:** el nivel de la base llega al modelo como palabra fija en el dato `precio`.
   - Los valores son `low` → "económico", `moderate` → "precio medio" y `high` → "caro". `unknown` no va.
   - El chequeo, en cualquier texto:
     - rechaza siempre montos ($, pesos, UYU, U$S, USD, dólares, euros);
     - rechaza siempre comparaciones de precio ("más barato que", "más caro", "precios más bajos"), aunque el dato esté;
     - rechaza una palabra de precio que no sea la de los datos ("barato" nunca pasa; "caro" con un dato "económico", tampoco).
   - "La carne que…" o "la carta que…" no cuentan como precio: hay un test para eso.
   - **Prueba real** con Inocencio Café (`precio: precio medio`), US$ 0,0103:

     > Cafetería chica y tranquila, con buen wifi para abrir la compu y quedarte laburando. Tiene café de especialidad y sándwich caliente para acompañar, y también sirve para un desayuno o una merienda. Precio medio.

     Usó la palabra tal cual y sin montos. **Pero "chica" no está en los datos**: es un invento chico que el chequeo no ve, porque no es horario, precio ni superlativo. Lo único que lo frena es el prompt. Opciones:
     - aceptar este margen y corregirlo a mano;
     - sumar una regla de tamaño ("chico", "grande", "amplio") que sólo pase si está en los datos;
     - una segunda pasada barata (Haiku) que compare el texto con los datos y marque frases sin respaldo.

## Para revisar o decidir

- **`groundingIssues` es un chequeo de palabras, no un juez:**
  - puede rechazar un texto válido que diga, por ejemplo, "abre la tarde con un café". Se arregla regenerando;
  - no detecta un plato inventado. Eso queda en manos del prompt y de los datos cerrados.
- **La idea no se guarda en la base:** sirve para buscar y como contexto de la IA mientras el editor está abierto.
- **Búsqueda contra producción:** con `APP_URL` en producción, la búsqueda usa la clave y la caché de la app de producción. La interpretación de la idea paga una llamada al modelo de la app la primera vez; después queda cacheada.
