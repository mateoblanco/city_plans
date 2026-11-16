# Reporte: popularidad, etapa 1 (sólo guardar eventos)

Sin commits. La app no muestra nada nuevo: los eventos se guardan y se ven sólo en el backoffice (**Popularidad**, `#/popularidad`).

Verificación:
- app: `yarn test` 1574 OK · `tsc --noEmit` limpio · `yarn lint` limpio.
- backoffice: `yarn test` 1071 OK (incluye 17 contra Postgres real con PGlite) · `tsc -b` limpio · `yarn lint` limpio · `yarn build` OK.

---

## Lo que tenés que hacer vos

1. **Correr la migración** `backoffice/drizzle/0025_place_events.sql` (`yarn db:migrate` en el backoffice). Crea sólo tres tablas nuevas (`place_events`, `place_event_daily`, `event_salts`) y no toca `places`. No la corrí.
2. **En Vercel, sólo en Production:**
   - `TRACK_EVENTS=true`.
   - `CRON_SECRET`, un valor aleatorio largo.
   - En Preview y Development no se define ninguna de las dos.
   - El flag se lee en el build de las páginas: prenderlo pide un deploy nuevo.
3. El cron ya está en `app/vercel.json` (`0 4 * * *` = 01:00 de Montevideo). Vercel lo corre sólo en Production.

`DEPLOY.md` y los dos `.env.example` ya lo dicen.

---

## 1) Qué se guarda

| Evento | Cuándo | Dónde |
|---|---|---|
| `view` | La ficha se muestra de verdad: en un efecto del navegador y con la pestaña visible (si se abrió en segundo plano, espera a que se vea). | `Tracking/PlaceViewBeacon`, dentro de `Details` en `PlacePage` |
| `save` / `unsave` | Después de `toggleSaved`, si funcionó. | `PlaceActions` (ficha) y `SaveButton` (corazón de la card) |
| `directions` | Click (también Cmd/Ctrl/Enter) o click del medio en el link **"Google Maps"** de la ficha. | `Tracking/DirectionsTracker` envuelve sólo el link; `PlaceLocation` sigue siendo server component |

Cada fila tiene lugar, tipo, código anónimo del día, fecha en Montevideo y el origen: `search`, `home` (con el id de la fila, p. ej. `breakfast` o `discount:itau`), `saved`, `similar`, `branch` o `direct`. Nunca guarda el texto de la búsqueda (el endpoint descarta cualquier campo de más).

- **Envío:** `sendBeacon` y, si no está o la cola está llena, `fetch` con `keepalive`. No espera ni reintenta: si falla, se pierde. El servidor responde 204 enseguida y guarda en `after()`.
- **Nunca se cuenta en el render del servidor ni en el prefetch:**
  - Los efectos no corren en el servidor (test con `renderToString`).
  - El prefetch de Next baja el payload pero no monta componentes. Con el flag prendido, Lighthouse en la home (con las cards a la vista, que se precargan) hizo 0 pedidos a `/api/events`.
  - Lighthouse en la ficha hacía exactamente 1, hasta que agregué el filtro de navegadores automatizados (abajo).
- **Origen:**
  - `Tracking/OriginLink` es el `<Link>` a la ficha de `PlaceCard`, `PlaceCardMini` (similares) y `BranchCard` (sucursales). Al hacer click deja el origen en memoria del módulo, junto con el slug de destino; la ficha lo usa una sola vez.
  - Sin click a esa ficha (link externo, recarga, atrás, pestaña nueva) es `direct`.
  - La URL no cambia y el prefetch es el de siempre.
  - Guardar o "Google Maps" dentro de la ficha usan el origen de la vista. El corazón de una card usa el de la card.

## 2) Anónimo y sin cookies

- **Código:**
  - Es `sha256(clave del día ‖ IP ‖ user agent)`, recortado a 32 hex (`server/events/visitor.ts`).
  - La clave es aleatoria (`randomBytes(32)`, en `event_salts`) y no sale de ninguna clave fija. El cron la borra apenas termina el día: después no hay forma de recalcular los códigos de ese día.
  - La IP y el user agent no se guardan ni se loguean. Un test revisa que no aparezcan en nada de lo que va a la base ni en el log de errores.
- **Sin cookies ni localStorage:** todo lo del cliente vive en memoria del módulo, y la respuesta no lleva `set-cookie` (tiene test).
- **Una vez por persona, lugar, tipo y día:** lo garantiza la restricción `place_events_once_per_day` (`unique (place_id, type, visitor, day)`). La consulta usa `on conflict do nothing`. Un insert directo repetido falla (test contra Postgres).
- **Sacar de guardados resta:**
  - Guardar borra el `unsave` de hoy de esa persona y, si no había, inserta `save`. Sacar hace lo contrario. Es una sola consulta.
  - Guardar y sacar el mismo día deja cero filas. Sacar hoy algo guardado otro día da −1 en el neto de hoy. En el resumen, `save` es el neto.

## 3) Qué no se cuenta

- **`TRACK_EVENTS` (apagado por defecto)**: sólo prende con exactamente `"true"`. Apagado:
  - `/api/events` responde 204 sin tocar la base.
  - El layout no renderiza `TrackingEnabled`.
  - La ficha no renderiza el beacon ni el contador de "Google Maps".
  - El código que envía (`send.ts`) está en un chunk aparte que se pide con `import()`: **nunca se baja**. Lo verifiqué en el build apagado: ningún script que carga la home, la ficha o `/search` contiene `/api/events`.
- **Bots:**
  - En el servidor, por user agent (crawlers, previsualizadores de links, Lighthouse/PageSpeed, headless, curl, python, etc.). También se descartan el user agent vacío y los pedidos de otro sitio (`Sec-Fetch-Site`).
  - En el cliente, `navigator.webdriver`.
  - Esto último lo agregué porque **Lighthouse 12 no se identifica en el user agent**: emula un Android común ("moto g power"). En la primera medición pasó el filtro y llegó a la base (no se guardó nada porque las tablas no existen). Marca `navigator.webdriver = true`, igual que Puppeteer, Playwright y Selenium. Con el chequeo, 0 pedidos.
- **Límite:** 30 eventos por código por minuto. Va dentro de la misma consulta (cuenta los del último minuto con el índice `(visitor, created_at)`).
- **Lugares:** sólo los publicados. Un id inventado o de un borrador no se guarda.

## 4) Resumen y limpieza

- `place_event_daily` (`place_id, type, day, total`, primary key de los tres) se guarda para siempre.
- **Cron `GET /api/cron/events-daily`** (necesita `Authorization: Bearer $CRON_SECRET`; sin eso, 401):
  1. Rearma el resumen de los **3 días cerrados** anteriores con `on conflict do update`. Es idempotente: si una corrida falla, la siguiente se pone al día. Ayer queda incluido.
  2. Borra los eventos de más de 90 días.
  3. Borra las claves de días anteriores.

## 5) Backoffice

- Pantalla **Popularidad** (`#/popularidad`).
  - Una fila por lugar con algún dato: vistas, guardados (neto) y "Cómo llegar", de 7 y 30 días.
  - Se ordena tocando cualquier encabezado (`aria-sort`).
  - Muestra de dónde vinieron las vistas de los 30 días (Búsqueda, Home, Guardados, Similares, Sucursales, Directo, en %) y las 3 filas de la home que más trajeron.
  - Tiene estados de cargando, vacío y error con reintentar.
- Los totales salen del resumen y van **hasta ayer**: el día en curso aparece después del cron de esa noche.
- `GET /api/popularity` (`server/popularity/`) devuelve 503 sin base y 500 con log si falla.

## Decisiones que quizás quieras revisar

- **"Cómo llegar" es el link "Google Maps"**, como acordamos. "Abrir en pestaña nueva" desde el menú contextual no dispara ningún evento en el DOM y no se cuenta.
- **Los guardados de la bienvenida de la home no cuentan.** Son la elección inicial de hasta 3 lugares (`addSaved`, no el corazón) e inflarían los lugares que sugiere ese diálogo. Si los querés, es un cambio chico donde la bienvenida llama a `addSaved`.
- **Borrar un lugar borra sus eventos y su resumen** (`on delete cascade`, como las demás tablas hijas). Si el resumen tiene que sobrevivir a un lugar borrado, se cambia la clave foránea antes de migrar.
- **El origen se fija con la primera vista del día.** Si alguien entra desde la búsqueda y más tarde desde la home, queda "búsqueda", porque la fila es una por día.
- **Origen de pestañas nuevas:** una card abierta con click del medio o Cmd+click cuenta como `direct`, porque la pestaña nueva no tiene la memoria de la anterior. No usé cookies ni la URL para pasarlo.

## Tests

**Contra Postgres real** (`backoffice/server/popularity/events-db.test.ts`, PGlite):
- Montaje: una tabla `places` mínima y sólo la `0025`, sin las migraciones con PostGIS ni pgvector.
- PGlite es devDependency y no está en el build de Vite.
- Corre las mismas consultas de `/shared/events.ts` que usa la app y prueba:
  - Restricción única: un insert directo repetido falla.
  - Una vez por día, aunque llegue dos veces.
  - Otro día, visitante, lugar o tipo cuentan aparte.
  - Lugar no publicado o inexistente.
  - Checks de tipo y origen.
  - Guardar y sacar el mismo día queda en cero.
  - Guardar, sacar y guardar queda en uno.
  - Sacar algo guardado otro día da −1 (el total de los dos días es cero).
  - Sacar no cancela el guardado de otro visitante.
  - El límite por minuto, y que pasado el minuto vuelve a guardar.
  - La clave del día no se pisa.
  - El resumen es idempotente y no incluye hoy.
  - El borrado de más de 90 días y de las claves viejas.
  - El cascade.
  - La consulta de la vista del backoffice.

**App (vitest):**
- `TRACK_EVENTS` sólo con `"true"`: sin la variable, como en desarrollo y previews, queda apagado.
- `isBot`.
- Día de Montevideo alrededor de la medianoche.
- El hash es estable en el día y cambia con la clave, la IP o el user agent.
- La IP y el user agent no llegan a la base.
- Ruta `/api/events`:
  - Apagada: 204 sin guardar.
  - Prendida: guarda después de la respuesta, sin cookies.
  - Bots y otro sitio: no guarda.
  - Body inválido: 400.
  - Descarta una `q`.
  - Si falla la base, no loguea la IP.
- Cron: 401 sin el secret; resumen y limpieza con las fechas correctas.
- Origen:
  - Se usa una vez.
  - Similares y sucursal.
  - Un click a otra ficha no se le pega a esta.
- `sendEvent`:
  - Con beacon.
  - Fallback con fetch keepalive.
  - Si falla, no tira error.
  - `webdriver` no envía.
- `whenVisible`: visible, oculta, desmontada.
- "Google Maps": click y click del medio, nunca preventDefault.
- `PlaceViewBeacon`: no envía en `renderToString` y sí al montarse.

**Backoffice:** endpoint, orden, porcentajes de origen y la página (cargando, tabla, ordenar, vacío, error y reintentar).

`google-cost-guard.test.ts` ahora también cubre `OriginLink`: los links a fichas siguen existiendo y ninguno cambia el prefetch. Un test exige que `OriginLink` no deje pasar props al `<Link>` (por ejemplo, `prefetch`).

## Peso en el cliente

JS transferido por página (Lighthouse mobile, `next start` local, gzip):

| Página | Antes (commit actual) | Flag apagado | Flag prendido |
|---|---|---|---|
| Home | 380.314 B | +1.174 B | +1.924 B |
| Ficha | 240.436 B | +810 B | +1.560 B |
| /search | 396.968 B | +882 B | +1.632 B |

- **Apagado (≈ 0,8–1,2 KB):** el stub de `track.ts`, `OriginLink` y los wrappers, que el bundler deja en chunks compartidos (no hacen pedidos ni envían nada). Parte de la diferencia son cambios en los hashes y en el empaquetado de chunks que ya existían.
- **Prendido, +750 B:** el chunk `send.ts`, que se baja aparte después de hidratar.
- No hay scripts nuevos en el HTML.

## Lighthouse

Mobile, mediana de 3 corridas por página, contra `next start` local:

| Página | | Perf | A11y | BP | SEO | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| Home | antes | 90 | 96 | 96 | 66 | 3,44 s | 2 ms | 0 |
| | apagado | 90 | 96 | 96 | 66 | 3,44 s | 2 ms | 0 |
| | prendido | 90 | 96 | 96 | 66 | 3,43 s | 1 ms | 0 |
| Ficha | antes | 75 | 96 | 96 | 58 | 5,83 s | 53 ms | 0 |
| | apagado | 75 | 96 | 96 | 58 | 5,80 s | 28 ms | 0 |
| | prendido | 75 | 96 | 96 | 58 | 5,81 s | 25 ms | 0 |
| /search | antes | 70 | 100 | 96 | 58 | 7,71 s | 56 ms | 0 |
| | apagado | 70 | 100 | 96 | 58 | 7,78 s | 40 ms | 0 |
| | prendido | 70 | 100 | 96 | 58 | 9,15 s | 46 ms | 0 |

- **No cambia ningún puntaje.**
- El LCP de `/search` prendido varía entre corridas por las tiles del mapa (`/search` no tiene ficha ni beacon; lo único extra son los 750 B). La ficha prendida, ya con el filtro `webdriver`, dio 75/75/75.
- SEO 58/66 es por `ALLOW_INDEXING` apagado (noindex), igual que antes.
- Las corridas de la ficha pagan Place Details (unas 12 cargas, ≈ USD 0,30).

## Prueba a mano después de migrar

No pude probar contra Neon: las tablas no existen hasta la migración. Con el server prendido, un pedido con user agent de iPhone llegó hasta la base y falló con `relation "event_salts" does not exist`, así que el camino completo funciona hasta ahí y no se escribió nada.

Después de migrar:
1. Con `TRACK_EVENTS=true` en `.env.local`, `yarn build && yarn start`.
2. En Network, abrir una ficha desde una card: tiene que salir un `POST /api/events` de tipo `view`. Pasar el mouse por cards y dejar que precarguen no tiene que mandar nada.
3. Recargar la ficha no tiene que sumar filas (`select type, origin, origin_row from place_events`).
4. Guardar y sacar: queda sin fila de `save`.
5. Click en "Google Maps": sale `directions`.
6. `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/events-daily` arma el resumen de días anteriores. Los eventos de hoy aparecen en el backoffice recién al día siguiente.
7. Borrar las filas de prueba antes de prender en Production (`delete from place_events; delete from place_event_daily; delete from event_salts;`).

## Archivos

- **Nuevos:**
  - `shared/events.ts`: tipos, orígenes y el SQL que usan la app y el backoffice.
  - `app/src/server/events/`
  - `app/src/app/api/events/`
  - `app/src/app/api/cron/events-daily/`
  - `app/src/components/Tracking/`
  - `backoffice/drizzle/0025_place_events.sql` y su snapshot
  - `backoffice/server/popularity/`
  - `backoffice/src/data/events.ts`
  - `backoffice/src/lib/popularity*.ts`
  - `backoffice/src/types/popularity.ts`
  - `backoffice/src/pages/popularity-page*.tsx`
- **Modificados en la app:**
  - `layout.tsx`
  - `PlacePage`
  - `PlaceLocation`
  - `PlaceActions`
  - `PlaceCard`
  - `SaveButton`
  - `PlaceRow`
  - `HomeSections`
  - `PlaceCardMini`
  - `BranchCard`
  - `server/db.ts`: `getSql()`, la única escritura
  - `vercel.json`
  - `google-cost-guard.test.ts`
  - `.env.example`
  - `AGENTS.md`
- **Modificados en el backoffice:**
  - `schema.ts`
  - `db/index.ts`: `sqlClient`
  - `app.ts`
  - `index.ts`
  - `App.tsx`
  - `AGENTS.md`
  - `package.json` y `yarn.lock`: PGlite
- **En la raíz:** `DEPLOY.md`.
