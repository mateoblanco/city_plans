# Reporte: Privacidad y Términos

Fecha: 24 de noviembre de 2026. **Nada commiteado.**

Contenido de `/privacy` y `/terms`, basado en un relevamiento del código de la app (y de `shared/`, de donde salen el SQL de eventos y la retención).

Marcas usadas en el reporte:
- **⚠ abogado**: conviene que lo revise un abogado.
- **⚠ confirmar**: es un dato que tenés que confirmar vos (en un panel o con un proveedor).

---

## 1. Relevamiento: qué hace la app con datos de quien la usa

### 1.1 En el navegador

No hay `sessionStorage`, IndexedDB ni cookies de terceros. Vercel Analytics y Speed Insights no ponen cookies.

| Nombre | Tipo | Qué guarda | Para qué | Duración | Código |
|---|---|---|---|---|---|
| `cityPlans.saved` | localStorage | `{ id, savedAt }` por lugar (tope 100) | Guardados (corazón) | Sin vencimiento | `pages/SearchPage/utils/saved.ts`, `place-list.ts` |
| `saved` | cookie (`SameSite=Lax`) | Solo ids, el más reciente primero | Espejo para el servidor: la home ("Guardados", "Para vos") y la búsqueda (perfil). Se usa en el pedido y no se guarda | 1 año | `saved-cookie.ts`, `place-list.ts` |
| `cityPlans.cards` | localStorage | Claves `banco.tipo` (p. ej. `itau.credit`) | Mis tarjetas | Sin vencimiento | `src/lib/my-cards.ts`, `utils/my-cards.ts` |
| `cards` | cookie | Las mismas claves | Filas de descuentos de la home | 1 año | ídem |
| `loc` | cookie | `lat,lng` redondeados a 3 decimales (~100 m), o `denied` o `skip` | Cerca mío. La leen `/search`, `/api/search`, `/api/search/widen` y la home; no se guarda | Coordenadas: 7 días, se renueva. `denied`: 1 año. `skip`: la sesión | `src/lib/location.ts`, `use-location.ts` |
| `cityPlans.welcome` | localStorage | `"1"` | No volver a mostrar la bienvenida | Sin vencimiento | `HomeWelcome/utils/welcome.ts` |

Además, el módulo de tracking guarda en memoria (sin persistir) el origen del último click a una ficha.

### 1.2 En el servidor y la base

**Eventos de popularidad**
- Dónde está el código: `shared/events.ts`, `server/events/*` y `/api/events`.
- Cuándo corre: solo con `TRACK_EVENTS=true`, que se prende en Production.
- Qué se ignora: bots, navegadores con `navigator.webdriver` y pedidos de otro sitio.
- Tabla `place_events`. Guarda:
  - `place_id`;
  - `type`: `view`, `save`, `unsave` o `directions`;
  - `visitor`;
  - `day`, en hora de Montevideo;
  - `origin`: search, home, saved, similar, branch, direct o guide;
  - `origin_row`: el id de la fila de la home o el slug de la guía;
  - `created_at`: el timestamp exacto, que usa el límite por minuto.

  Nunca guarda el texto de la búsqueda.
- El código `visitor`:
  - Se arma como `sha256(clave del día ‖ IP ‖ user agent)`, recortado a 32 caracteres hex.
  - La IP y el user agent se usan solo para ese cálculo. No se guardan ni se loguean: el `console.error` solo incluye el tipo y el mensaje.
  - La IP sale de `ipAddress()` de `@vercel/functions` o, si no está, de `x-forwarded-for`.
- La clave del día:
  - Es aleatoria, de 32 bytes, y vive en `event_salts`.
  - El cron de las 04:00 UTC (01:00 de Montevideo) borra las claves de los días anteriores.
  - Una instancia caliente puede tener en memoria la clave de ayer hasta su próximo evento o hasta reciclarse. No sale de memoria ni se puede consultar, pero el texto dice que se borra a la 1 de la mañana, que es lo que pasa en la base.
- Límites: 30 eventos por minuto por código y uno por (lugar, tipo, código, día).
- Conservación:
  - Los eventos se borran a los 90 días.
  - El resumen `place_event_daily` (lugar, tipo, día, total) queda para siempre y no tiene código de visitante.

**Caché de búsquedas** (`server/search/runtime-cache.ts`, `SEARCH_CONFIG.cache`)
- Hay dos capas: la memoria de la instancia y Vercel Runtime Cache.
- Interpretación:
  - Clave: `search:i:v12:<sha256(modelo + texto normalizado)>`.
  - Valor: la interpretación estructurada (categorías, tags, barrios, `nameQuery`, `vibe`, platos, `unrecognized`, etc.). **Puede repetir fragmentos del texto**, por ejemplo en `nameQuery`, `unrecognized` o `vibe`.
  - Dura 30 días.
- Embedding:
  - Clave: `search:e:<sha256(modelo + texto)>`.
  - Valor: un vector Float32.
  - Dura 90 días.
- Nada queda asociado a una persona. Lo personal (guardados, ubicación) no se cachea.

**Otros datos**
- La búsqueda de la bienvenida (`/api/welcome/search`) busca solo por nombre en la base: sin modelo y sin guardar nada.
- Logs:
  - Los `console.error` y `console.warn` no incluyen la IP, el user agent ni el texto.
  - Los **logs de pedidos de Vercel** sí registran la URL (con `q=` en `/search` y `/api/search`), la IP y el user agent.

### 1.3 Terceros

| Tercero | Qué le llega | Cómo | País / región |
|---|---|---|---|
| **Vercel**: hosting, CDN, funciones, Runtime Cache, cron | Todo pedido: IP, user agent, URL (con el texto de búsqueda en `q=`) y las cookies propias | Directo | Vercel Inc., EE. UU. Funciones en `gru1` (São Paulo, Brasil); CDN global |
| **Vercel Web Analytics** | Página (URL **sin** `q`, `near` ni `preview`: los saca `beforeSend`, ver 4), referrer, navegador, dispositivo, SO y país. Identifica con un hash del pedido que se descarta a las 24 h | Script en el navegador | EE. UU. |
| **Vercel Speed Insights** | Ruta, URL (con el mismo filtro), red, navegador, dispositivo, SO, país y Web Vitals | Script en el navegador | EE. UU. |
| **Vercel AI Gateway → Anthropic** | `Consulta: <texto normalizado>`. El modelo es `anthropic/claude-haiku-5.5` o lo que diga `SEARCH_MODEL`. Sin ubicación, guardados ni IP | Servidor → Gateway → proveedor | EE. UU. |
| **Vercel AI Gateway → OpenAI** | El mismo texto, para el embedding `openai/text-embedding-3-small` | ídem | EE. UU. |
| **Google Maps Platform** | Maps JS (en `/search` y en la ficha en desktop) y Static Maps (en la ficha en mobile): el navegador llama directo a Google, que recibe la IP, el user agent y el referrer. Place Details: lo pide nuestro servidor solo con el `google_place_id`, sin datos de la persona y sin caché. Links salientes a Google Maps | Navegador y servidor | EE. UU. / global |
| **Neon** (ahora parte de Databricks) | Base: lugares, `place_events` y `event_salts` | Servidor | AWS `sa-east-1` (São Paulo, Brasil) |
| **Cloudflare R2** | Los logos se cargan **directo desde el navegador** (`PlaceImage` con `unoptimized`), así que Cloudflare recibe la IP | Navegador | Red global; Cloudflare Inc., EE. UU. |
| **Fontshare (Indian Type Foundry)** | El CSS de Switzer (`api.fontshare.com`) y los woff2 (`cdn.fontshare.com`): recibe la IP y el user agent. **No estaba en tu lista.** Además, la imagen OG de la ficha baja la fuente desde el servidor, sin datos de nadie | Navegador | India (ITF, Ahmedabad); el CDN puede estar en otro lado |
| Links salientes: Instagram, WhatsApp (`wa.me`), sitios de bancos y de lugares | Lo que el navegador mande al abrirlos | Solo si se tocan | — |

Merriweather se sirve desde el propio sitio (`next/font`). No hay otras librerías de terceros en el navegador.

### 1.4 ¿Algo identifica a una persona?

- **La IP y el user agent llegan a**:
  - Vercel: logs, Analytics y Speed Insights, cada uno con su propio tratamiento.
  - Google: los mapas.
  - Cloudflare: los logos.
  - Fontshare: las tipografías.
- **Nosotros** solo los usamos para el código del día de los eventos y no los guardamos.
- **No hay**: cuentas, mails, nombres, teléfonos ni identificadores persistentes propios.
- **La ubicación** es aproximada (~100 m), queda en una cookie del navegador y no se guarda del lado del servidor.

---

## 2. Qué hice

**Archivos** (sin commitear; edité encima de tus cambios sin pisar nada):
- [src/lib/legal.ts](src/lib/legal.ts) (nuevo): `LEGAL_PAGES` (ruta, título y fecha de "Última actualización" de cada página) y `LEGAL_CONTACT_EMAIL`. Lo leen la página, la metadata y el sitemap.
- [LegalPage.tsx](src/components/pages/LegalPage/LegalPage.tsx) y su scss:
  - Recibe `page="privacy" | "terms"`.
  - Estructura: h1, "Última actualización: 24 de noviembre de 2026" (con `guideDate`), el índice "En esta página" (una tarjeta con una lista numerada de links `#id`) y las secciones, cada una con su h2 `id` y un `#` de ancla (visible al pasar el mouse o con foco; en touch siempre visible y tenue).
  - Tipografía como las guías: h1 de `GuideHeader`, cuerpo de 17/26 px como la introducción y ancho de lectura de 640 px.
  - `scroll-margin-top` con `--header-offset`.
- Componentes nuevos en `LegalPage/`:
  - [LegalTable](src/components/pages/LegalPage/LegalTable/LegalTable.tsx): tabla con scroll horizontal propio, con `role="region"` y foco para que se pueda scrollear con el teclado.
  - [ExternalLink](src/components/pages/LegalPage/ExternalLink/ExternalLink.tsx): link a otro sitio que abre en otra pestaña.
- Los textos: [content/privacy.tsx](src/components/pages/LegalPage/content/privacy.tsx) y [content/terms.tsx](src/components/pages/LegalPage/content/terms.tsx).
- [privacy/page.tsx](src/app/privacy/page.tsx) y [terms/page.tsx](src/app/terms/page.tsx):
  - Saqué el `noindex`.
  - Sumé `description` y Open Graph/Twitter como las guías (con `shareDescription` y `DEFAULT_OG_IMAGE`).
  - El canonical no cambió.
- Sitemap: [indexing.ts](src/server/seo/indexing.ts) suma `/privacy` y `/terms` (`yearly`, prioridad 0.3, `lastmod` = la fecha de `LEGAL_PAGES`). El test está actualizado. El import es relativo porque `next.config.ts` importa ese archivo y ahí no resuelve `@/`.
- [AGENTS.md](AGENTS.md): actualicé el párrafo de las páginas legales (decía "sin contenido, noindex").
- Footer: ya tenía los links a las dos páginas; no lo toqué.

**Verificación**
- `tsc`, `yarn lint` y `yarn test` pasan (1816 tests). `yarn build` pasa y las dos páginas salen estáticas (○).
- Con `VERCEL_ENV=production ALLOW_INDEXING=true` (build y `yarn start`):
  - Las dos páginas salen sin meta robots.
  - El canonical es el correcto.
  - El sitemap trae `/privacy` y `/terms` con su `lastmod`.
  - Con la indexación apagada siguen `noindex`, como todo el sitio.

  Después volví a armar el build normal.
- Con Playwright a 375 y 1280 px:
  - No hay scroll horizontal; la tabla scrollea dentro de su contenedor.
  - El click en el índice deja el h2 a 16 px debajo del header.
- Las URLs de las políticas de terceros, comprobadas una por una:
  - Vercel, Google, los Términos Adicionales de Google Maps, Anthropic, OpenAI, Cloudflare y la URCDP cargan.
  - La de Neon redirige a Databricks, así que puse la de Databricks.

---

## 3. Para revisar

### Con un abogado ⚠
1. **Domicilio del responsable.** El art. 13 de la Ley 18.331 pide informar la identidad **y el domicilio** del responsable. Hoy dice "Mateo Blanco, en Montevideo, Uruguay" y el mail. Falta decidir si alcanza o hay que poner una dirección.
2. **Inscripción de la base ante la URCDP** (arts. 28–29). ¿Hay que inscribir `place_events` (o la operación del sitio)? Probablemente dependa de si el código diario se considera dato personal (punto 3).
3. **¿El código diario es dato personal?** Mientras existe la clave del día, es seudónimo: con la clave, la IP y el user agent se podría recalcular. Después de borrarla es anónimo. El texto lo presenta como "anónimo"; conviene validar esa palabra.
4. **Base legal.** No la nombré explícitamente: el texto describe qué se hace y para qué. Hay que ver si conviene invocar el consentimiento (art. 9), la ejecución del servicio pedido o la disociación, sobre todo para la medición y el envío del texto al modelo.
5. **Transferencias internacionales** (art. 23). Los datos van a EE. UU. (Vercel, Anthropic, OpenAI, Google, Cloudflare), Brasil (Vercel `gru1`, Neon) e India (Fontshare).
   - No pude confirmar si la URCDP considera "adecuados" a Brasil o EE. UU.
   - El texto informa la transferencia (art. 13 F) y dice que puede ir a países sin un nivel de protección equivalente.
   - Falta definir en qué excepción se apoya: consentimiento, necesidad para el servicio o cláusulas contractuales de los proveedores (los DPA de Vercel, Google, etc.).
6. **Limitación de responsabilidad y "aceptás al usar".** Hay que ver qué tan lejos puede ir frente a la Ley 17.250 de Defensa del Consumidor en un servicio gratuito. Dejé la salvedad de que no limita los derechos del consumidor ni las normas imperativas.
7. **Menores.** Puse "no está dirigido a menores de 18 años" (muchos lugares son bares) y que, si un menor nos mandó datos, los borramos. Hay que decidir si conviene otra edad o redacción.
8. **Plazos para responder los derechos.** Puse "dentro de los plazos de la ley" en vez de un número (la ley fija 5 días hábiles para acceso y para rectificación/supresión).
9. **Términos: "Podemos limitar o bloquear el acceso"** y la prohibición de scraping. Revisar si hace falta algo más (p. ej. sobre la base de datos como obra protegida).

### Datos a confirmar vos ⚠
10. **Cuánto conservan los logs de Vercel** (depende del plan y de si hay log drains). El texto dice "un período breve, según el plan de Vercel".
11. ~~Vercel Web Analytics y el `q=`~~: resuelto con `beforeSend` (ver 4).
12. **AI Gateway y los proveedores.**
    - Vercel lo confirma en su documentación oficial ([Security and Compliance](https://vercel.com/docs/ai-gateway/security-and-compliance)): "AI Gateway uses zero data retention by default… permanently deletes your prompts and responses after requests complete". Guarda metadatos (modelo, proveedor, tokens, costo, duración). La política lo dice con link a esa página.
    - Anthropic (API) borra entradas y salidas a los 30 días, salvo las marcadas por políticas de uso.
    - Para OpenAI **no encontré** el plazo de retención de la API. Su política de privacidad dice que no cubre la API; sí confirma que por defecto no entrena con datos de la API.
    - El texto queda genérico: "pueden conservarlo un tiempo limitado… por defecto no lo usan para entrenar".
    - Opción técnica, **no aplicada**: el Gateway tiene `zeroDataRetention: true` y `disallowPromptTraining: true` por pedido. Hoy el código no los pasa. Prenderlos haría el texto más fuerte; habría que ver si limita qué proveedores o modelos se pueden usar.
    - Confirmar también si el Gateway puede enrutar Claude por Bedrock o Vertex en lugar de Anthropic directo. Eso cambia el tercero.
13. **Fontshare.** La línea de la política ya aclara que solo sirve Switzer (el texto) y que Merriweather (títulos) se sirve desde el sitio; si Switzer pasa a servirse desde el sitio, sacar Fontshare de la política y de este reporte. No encontré una política de privacidad propia (las páginas de fontshare.com no muestran texto sin JS). Linkeé la de Indian Type Foundry, que es de su tienda y no habla de los pedidos de fuentes. Opciones:
    - confirmar la política de Fontshare;
    - aceptar el link a ITF;
    - servir Switzer desde el sitio. AGENTS.md dice que la licencia lo permite en el sitio propio, pero no en un repo público.
14. **Neon/Databricks.** `neon.com/privacy-policy` redirige al aviso de Databricks, que es el que linkeé. Confirmar que es el que aplica a tu cuenta.
15. **"Algunos datos los arma un proceso automático a partir de fuentes públicas"** (Términos, sección de información). Lo escribí por el pipeline del backoffice. Confirmá que la descripción es justa.
16. **`created_at`.** Los eventos guardan la hora exacta, no solo el día. El texto dice "el día", que es lo que se usa. Si querés ser exacto, cambiar a "el día y la hora", o dejar solo el día en la tabla. Para eso habría que cambiar el límite por minuto.
17. **Las fotos de las guías** (`GuidePhoto`): el tipo existe pero todavía no tienen un origen. Si se sirven desde un tercero, hay que sumarlo a la política.

### Mantenimiento
- Si cambia algo del relevamiento (una cookie nueva, otro proveedor, otra retención, otro modelo en `SEARCH_MODEL`), hay que actualizar `content/privacy.tsx` y subir `updatedAt` en `src/lib/legal.ts`. Eso también cambia el `lastmod` del sitemap. Lo dejé anotado en AGENTS.md.

---

## 4. Ajustes posteriores (medición y política)

1. **Analítica sin texto de búsqueda.** [WebAnalytics](src/components/WebAnalytics/WebAnalytics.tsx) (cliente) reemplaza a `<Analytics />` y `<SpeedInsights />` del layout, con un `beforeSend` en cada uno que pasa la URL por `analyticsUrl` ([src/lib/analytics-url.ts](src/lib/analytics-url.ts), con test). Saca:
   - `q`: el texto que escribe la persona. Es el único parámetro de página con texto libre; el resto (`f`, `remove`, `intent`, `sub`, `loc`, `profile`, `debug`) son ids o filtros de la app.
   - `near`: el formato viejo `near=lat,lng`, con las coordenadas de quien compartió el link.
   - `preview`: la clave secreta de la vista previa de guías, que si no quedaba en Analytics.

   El buscador de la bienvenida (`/api/welcome/search?q=`) es una API y no pasa por Analytics. La política ahora dice que el texto de búsqueda **no llega a la analítica**. Los **logs de pedidos de Vercel** (hosting) siguen viendo la URL completa, que la política cubre en "Datos técnicos de cada pedido".
2. **AI Gateway.** La afirmación está confirmada en la documentación oficial de Vercel (no solo en una guía de su base de conocimiento). La mantuve, ahora con "según su documentación" y el link, y aclaro que guarda solo datos de uso.
3. **Fontshare.** Corregí la línea: decía "las tipografías del sitio", pero solo sirve Switzer; Merriweather (títulos) ya se servía desde el sitio.
