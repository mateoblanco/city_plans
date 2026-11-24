# Refresco de coordenadas de Google

Proceso diario que refresca las coordenadas de Google antes del límite de 30 días de los términos. También marca para revisión los lugares que se movieron, que Google ya no encuentra o que Google reemplazó por otro.

**Estado: sin commitear.** La migración `0031_google_refresh` está generada pero no se corrió.

## Qué hace falta antes de probar

1. **Migración.** Desde `backoffice/`, correr `yarn db:migrate`, que aplica `drizzle/0031_google_refresh.sql`. La migración:
   - crea `place_google_flags` (los avisos) y `google_refresh_runs` (una fila por corrida);
   - recrea el check `places_review_reasons_check` con dos motivos nuevos, `location_moved` y `not_found_in_google`, que usa "Despublicar".

   Sin la migración, el cron responde 500 ("relation does not exist") y el panel del backoffice muestra el error.
2. **Variables.** `CRON_SECRET` (el mismo del cron de eventos) y `GOOGLE_PLACES_API_KEY`, que ya están.

## Costo

Según la documentación de Google consultada el 24/11/2026 (Place Details, data fields y pricing):

| Campo | SKU | Gratis por mes | Después |
|---|---|---|---|
| `location` | Place Details Essentials | 10.000 | US$5 cada 1.000 |
| `movedPlaceId` | Essentials IDs Only | ilimitado | gratis |
| `businessStatus` | Place Details **Pro** | 5.000 | US$17 cada 1.000 |

- **Máscara usada: `location,movedPlaceId`.** Se cobra como Essentials.
- **Volumen.** Con 778 lugares, cada uno se pide una vez cada ~25 días, o sea ~930 pedidos por mes.
- **Cupo.** Las fichas usan Enterprise, que tiene su propio cupo gratis, así que no comparten el cupo de Essentials.
- **Estimado: US$0 por mes.** Si algún día se pasara el cupo gratis, serían ~US$5.
- **`businessStatus` quedó afuera por tu decisión.** Con él, el pedido se cobraría como Pro: probablemente US$0 igual, y en el peor caso ~US$13–16 por mes.
  - Los cerrados se siguen detectando con `yarn places:check-status`, el script manual del backoffice.
  - Para sumarlo: agregar `businessStatus` a `REFRESH_FIELD_MASK`, sumar dos ramas en `decide.ts` y dos motivos en `/shared/google-flags.ts`, con su migración del check.

## Tanda y horario

- **Horario.** `0 7 * * *`: 07:00 UTC, 04:00 en Montevideo, 3 horas después del cron de eventos.
- **Tanda de 40 por día.**
  - Al principio, los 778 se ponen al día en ~20 días.
  - Después se piden ~31 por día, con 5 días de margen antes de los 30 (se refresca a los 25).
- **Selección.** Publicados con `coordinates_source = 'google'` y `google_place_id`, con `coordinates_fetched_at` de más de 25 días o sin fecha. Van primero los más viejos (los sin fecha antes que todos).
- **Ritmo.** Los pedidos van de a uno, así que no compiten con la cuota por minuto que comparten con las fichas. `maxDuration` es de 60 s.

## Qué hace con cada respuesta

| Respuesta de Google | Qué hace |
|---|---|
| ok, a menos de 100 m | Actualiza `location` y `coordinates_fetched_at`, sin tocar `updated_at`. Cierra un "no encontrado" o "reemplazado" que estuviera abierto. |
| ok, a más de 100 m | Actualiza igual y abre "Se movió" con los metros. |
| ok con `movedPlaceId` | Actualiza y abre "Google lo reemplazó por otro lugar" con el id nuevo. No cambia `google_place_id` sola. |
| 404 NOT_FOUND, o 400 por un place_id inválido | Abre "No encontrado en Google". No toca la ubicación ni la fecha, así que se vuelve a probar al día siguiente. |
| 401, 403 o "API key not valid" | Corta la corrida (`authorization`), sin reintentar. |
| 429 | Corta la corrida (`quota`), sin reintentar. |
| 5xx, red, otro 400 | Cuenta como fallido y sigue con el siguiente. |

- Nunca despublica nada sola.
- Los avisos no se duplican (hay uno por lugar y motivo):
  - uno ya abierto no se vuelve a contar;
  - uno ignorado sigue ignorado, salvo un movimiento nuevo de más de 100 m o un reemplazo por otro id distinto.
- Cada corrida guarda en `google_refresh_runs`:
  - cuántos refrescó, marcó y fallaron;
  - por qué cortó, si cortó;
  - cuántos publicados quedan con coordenadas de más de 30 días.
- El mismo resumen queda en el log de Vercel (`[google-refresh] {...}`).

## Backoffice

En Lugares, arriba de los filtros, hay un panel "Avisos de Google (N)":

- **Siempre visible:** "N lugares con coordenadas de más de 30 días · Última corrida: fecha, refrescó X, marcó Y, fallaron Z". Si la corrida cortó, también dice por qué.
- **"Ver avisos":** abre la tabla con Lugar, Motivo (con los metros o el id nuevo), Detectado y Acciones.
  - **Despublicar**, con confirmación:
    - pasa el lugar a «A revisar» con el motivo «Se movió según Google» o «No encontrado en Google», sumado a los que ya tenía;
    - lo fija en `manual_overrides`, como Publicar, para que ni el pipeline ni `places:check-status` lo reviertan;
    - cierra el aviso;
    - se deshace con Publicar.
  - **Ignorar:** deja de mostrar el aviso.

## Decisiones distintas al plan

- **Panel en vez de cuarta pestaña.** Los avisos van en un panel arriba de la lista. Así la cantidad de atrasados se ve siempre y no se toca la lógica de pestañas, contadores y filtros de la lista.
- **Despublicar va por el aviso.** Usa `POST /api/google-flags/:id/unpublish` y no se amplió `PATCH /api/places/:id/status`. El motivo sale del aviso, el aviso se cierra en la misma sentencia y no se tocan los fakes de `PlacesReader`.
- **Motivo de corte extra.** Sumé `missing_key`: sin `GOOGLE_PLACES_API_KEY`, la corrida queda registrada como cortada.
- **SQL compartido.** El SQL de avisos y corridas está en `/shared/google-flags.ts`, como `shared/events.ts`. Así el test PGlite del backoffice lo prueba contra la migración real.

## Para tener en cuenta

- **Un "no encontrado" se pide todos los días** hasta que se despublique o se ignore, porque no se actualiza su fecha. Ignorarlo no lo saca de la tanda: el cron lo sigue pidiendo. No sé si Google cobra los 404.
- **El contador de atrasados puede no llegar a 0.** Incluye a los publicados con `coordinates_source = 'google'` y sin `google_place_id`, que el cron no puede refrescar.
- **La primera corrida** toma primero los que no tienen fecha.

## Archivos

- **App**
  - `src/server/places/refresh/google.ts`: el pedido a Google y cómo se interpreta cada respuesta.
  - `src/server/places/refresh/decide.ts`: qué hacer con cada lugar (pura).
  - `src/server/places/refresh/run.ts`: la corrida.
  - `src/app/api/cron/google-refresh/route.ts`.
  - Tests en las carpetas `test/` de cada uno.
  - `vercel.json`.
  - `AGENTS.md`: sección nueva "Refresco de coordenadas de Google". `AGENTS.md` tenía cambios tuyos sin commitear; edité encima sin tocarlos.
  - Comentario de `src/server/db.ts`.
- **Shared:** `shared/google-flags.ts`.
- **Backoffice**
  - `server/db/schema.ts`, `drizzle/0031_google_refresh.sql` y `meta`.
  - `src/data/google-flags.ts`, `src/data/review-reasons.ts`.
  - `server/google-flags/` (store, rutas, tests).
  - `server/app.ts`, `server/index.ts`.
  - `src/components/google-flags-panel.tsx` y su test.
  - `src/lib/google-flags-api.ts`, `src/types/google-flags.ts`.
  - `saved-places-page.tsx` y su test: el servidor falso responde `/api/google-flags`.
  - `AGENTS.md`.
- **`DEPLOY.md`:** el pendiente pasa a "correr la `0031` antes del deploy".

## Verificación

- **App:** `yarn test` 1845/1845, `yarn tsc --noEmit` y `yarn lint` sin errores.
- **Backoffice:** `yarn test` 1186/1186 en dos corridas seguidas, `yarn build` (que también verifica los tipos) y `yarn lint` sin errores.
  - En la primera corrida completa falló 1 test. En las dos siguientes no falló ninguno, así que parece intermitente. No vi cuál era.

Lo que cubren los tests:
- selección por antigüedad y tamaño de tanda;
- umbral de 100 m (99 y 101 m);
- `movedPlaceId` y place_id inválido;
- corte por 403 y por 429 sin seguir pidiendo;
- autorización del cron;
- SQL de avisos contra Postgres real (PGlite): reapertura, ignorados, check de motivos, atrasados;
- Despublicar sin tocar `updated_at`;
- UI: carga, vacío, error inicial con Reintentar, error por fila, confirmación.

## Cómo probar

1. En `backoffice/`, `yarn db:migrate`.
2. En `app/`, `yarn dev` y después:
   ```sh
   curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/google-refresh
   ```
   Hace hasta 40 pedidos reales a Google, dentro del cupo gratis de Essentials. Responde el resumen.
3. Con `curl` sin el header debería dar 401.
4. Mirar `google_refresh_runs` y Lugares › Avisos de Google en el backoffice (`yarn dev`).
