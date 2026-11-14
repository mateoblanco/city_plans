# Reporte: tres mejoras (drawer de /search, "Ver todos" de la home, filas con texto)

Sin commits. 18 archivos modificados y 2 nuevos (`git status`). `search-href.ts` **no se tocó**.

Verificación: `yarn test` 1535 OK · `tsc --noEmit` limpio · `yarn lint` limpio.

---

## 1) Drawer de /search en mobile: scrollear lo expande

**Base UI no lo trae.** `@base-ui/react` 1.9.0, la última publicada: sobre una lista con scroll, `DrawerViewport` sólo toma el gesto **hacia abajo** con el scroll arriba de todo. Hacia arriba deja el scroll nativo y nunca pasa el gesto de panel a lista. Decidimos Base UI + una capa propia.

**Qué hace:**
- En la media, el dedo hacia arriba sobre la lista sube el panel.
- Al llegar a la alta, en el mismo gesto, la lista sigue scrolleando sin levantar el dedo. Al soltar sigue con inercia.
- Si se suelta antes de la alta, va a la altura más cercana o a la que indica la velocidad.
- Con la lista arriba de todo en la alta, arrastrar hacia abajo baja a la media (Base UI, como antes).
- Al pasar de la alta a la media, la lista vuelve arriba de todo.

**Cómo:**
- `Results/ResultsSheet/use-scroll-expand.ts` (nuevo):
  - Escucha en `window` en captura y toma sólo el caso "media + dedo hacia arriba". Cuando lo toma, lo corta antes que Base UI.
  - Mueve el panel con `--sheet-drag`; `data-dragging` le saca la transición mientras tanto.
  - Cuando Base UI aplica la altura nueva, un MutationObserver sobre el estilo del popup recalcula `--sheet-drag` en el mismo frame. Por eso no salta.
- `utils/sheet.ts`: la lógica pura, con tests: `splitDrag` (cuánto es panel y cuánto es scroll), `releaseSnap` (a qué altura va al soltar) y `momentumStep` (inercia).
- `ResultsSheet.module.scss`: `--sheet-drag` en el `transform` y en el `padding-bottom` (la lista crece mientras el panel sube, sin hueco abajo). `[data-dragging]` sin transición.

**Lo que no cambia:** la manija (arrastre, toque, Enter), el título, la media hacia abajo, la alta, la rueda, el teclado y el foco siguen siendo de Base UI y del scroll nativo. Con movimiento reducido, los cambios de altura siguen sin animación.

### Prueba en iPhone y Android emulados (Playwright con touch)

Script: `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans-backoffice/0f51568d-0537-4946-9e92-1268db20aa6c/scratchpad/pw/gesture.mjs`, contra tu `next dev` en :3000, con `/search?q=pizza&loc=all`.

| Prueba | Pixel 7 (Chromium, touch real por CDP) | iPhone 15 (WebKit, touch sintético) |
|---|---|---|
| Media → arriba en un gesto: llega a la alta | OK | OK |
| La lista sigue scrolleando sin soltar | OK (desde el paso 19/40) | OK (desde el paso 15/40) |
| Sin saltos (máx. por paso, con pasos de ~15 px) | 16 px | 14 px |
| El panel queda quieto mientras scrollea la lista | OK | OK |
| "Buscar en esta zona" no se ve en la alta | OK | OK |
| Alta + lista arriba → abajo: a la media | OK | **no probado** (es de Base UI y en WebKit no hay touch nativo) |
| Soltar cerca de la media: vuelve a la media | OK | OK |
| Manija con Enter: media → alta → media; el foco queda en la manija | OK | OK |
| Toque en la manija | OK | OK |
| Mover el mapa muestra "Buscar en esta zona" y busca en la zona | OK | no probado (sin touch nativo) |
| Movimiento reducido: sin transición (`0s`) | OK | OK |

Ojo: WebKit de Playwright no es un iPhone de verdad. Le mando eventos con `touches` (lo que leen el hook y Base UI), pero no hay scroll nativo. **Vale probarlo en un iPhone real.**

Videos:
- `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans-backoffice/0f51568d-0537-4946-9e92-1268db20aa6c/scratchpad/videos/android-pixel7.webm`
- `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans-backoffice/0f51568d-0537-4946-9e92-1268db20aa6c/scratchpad/videos/iphone15.webm`
- `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans-backoffice/0f51568d-0537-4946-9e92-1268db20aa6c/scratchpad/videos/android-pixel7-reduce.webm`
- `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans-backoffice/0f51568d-0537-4946-9e92-1268db20aa6c/scratchpad/videos/iphone15-reduce.webm`
- Captura a mitad del arrastre, sin hueco: `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans-backoffice/0f51568d-0537-4946-9e92-1268db20aa6c/scratchpad/middrag.png`

El aviso "1 Issue" del overlay de Next en esas corridas es de Google Maps: sin WebGL en headless cae al mapa raster. No tiene que ver con estos cambios.

---

## 2) "Ver todos" → intención y sub

### Tabla fila → destino (la verifica `home.test.ts`)

| Fila | Antes | Ahora |
|---|---|---|
| Para desayunar | `tag:breakfast` | **Comer › Desayuno** |
| Brunch | `tag:brunch` | **Comer › Brunch** |
| Café de especialidad | Cafés › Especialidad | igual |
| Para almorzar | Comer › Almuerzo | igual (ahora suma cafés, ver abajo) |
| Para cenar | Comer › Cena | igual (ahora suma cafés) |
| Para tomar un café | Cafés | igual |
| Para tomar algo | Tomar algo | igual |
| Algo rápido | Comer + `tag:quick` | Comer + texto (punto 3) |
| Menú del día | `tag:menu_of_the_day` | texto (punto 3) |
| Merienda para 2 · After office · Juntada con amigos · Salida en pareja | `tag:` | **sin par** → texto (punto 3) |
| Comidas del mundo · Clásicos uruguayos | `section:` | **sin par**, sin cambio (con su chip) |
| Vegetariano · Sin TACC | `diet:` | **sin par**, sin cambio |
| Abierto ahora (trasnoche) | vacía | **sin par**, sin cambio |

Todas siguen con `open:now` y `loc=all`.

### En Comer manda el tag de comida (`tagWins`, lo que elegiste: opción 4)

- `shared/intents.ts`: `IntentDef.tagWins`. En Comer van todos los tags de comida (FOODS, CUISINES, Desayuno, Brunch, Almuerzo, Cena, menú del día, tenedor libre); Al aire libre no.
- `server/search/intents.ts`: `intentGroups(intent, subs, tags)` saca el match de Comer si un sub activo, un tag exigido o el tag de un plato está en `tagWins`. `subTerms` y el aviso de relajar ahora usan `subGroups`, que ya no suponen que el primer grupo es la intención.
- Al relajar, la intención vuelve a filtrar.
- Cafés no cambia: "brunch en un café" sigue siendo Cafés › Brunch.

### Datos reales (Neon, sólo lectura)

| tag | total | cafés que antes quedaban afuera de Comer |
|---|---|---|
| brunch | 73 | 30 |
| breakfast | 266 | 128 |
| lunch | 421 | 107 |
| dinner | 344 | 19 |
| menu_of_the_day | 71 | 8 |
| sandwiches | 185 | 71 |
| tarts / salads / smoothies / milanesa | 63 / 140 / 42 / 135 | 25 / 16 / 14 / 11 |

El resto de los platos dejaba entre 1 y 5 cafés afuera cada uno.

### Punto de control con search-eval (top 8; ☕ = Café, no Comer)

La comparación usó la misma interpretación, los mismos embeddings y la misma hora que el punto de partida, sin llamadas pagas. Detalle: `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans-backoffice/0f51568d-0537-4946-9e92-1268db20aa6c/scratchpad/eval-compare.md` y `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans-backoffice/0f51568d-0537-4946-9e92-1268db20aa6c/scratchpad/top8.md`.

- **sándwiches:** entra **Emporio de los Sándwiches ☕** (bakery, cafe) en el 1.º lugar y los demás bajan un puesto; Bar Arocena sale del top 10. Es un local especializado en sándwiches, así que no lo vi como "un café arriba de restaurantes claramente mejores" y seguí. **Revisalo vos.** Antes: Sanguche, Sésamo, Pastrami, Rincón gastronómico, Don Luiggi, Bar Tinkal, BBQ, Expreso.
- **almorzar:** ningún café en el top 8. Se reordenan (Almazara y Pausat suben 2) porque cambia el pool. Ladero bodegón sale del top 8 y entran Agosto café & dulces y Doña Mora en el 9 y 10.
- **milanesas:** sin cafés; Tres Fuegos y La Rotisería intercambian lugar.
- **cenar** y **pizza:** idénticos.

---

## 3) Filas con texto en el buscador, sin chip que repita

- Las filas por tag tienen `text` en `server/home/config.ts`, y `homeViewAllUrl` arma su "Ver todos" con ese texto en lugar del `tag:`. La fila sigue buscando sin texto, con el tag, sin pagar nada.
- `server/search/dictionary.ts`, `ROW_PHRASES`. Sólo si la consulta es **entera** el nombre de una fila: salida en pareja → date, juntada con amigos → groups, merienda para 2/dos → shared_afternoon_tea, after office → after_office, menú del día → menu_of_the_day (+ Comer), algo rápido → quick.
  - Exige los mismos tags que hoy, también los momentos (sin `tidy`, como `tag:` en la URL).
  - Lleva la intención de la fila: "after office" no elige Bares.
  - Con algo más escrito ("juntada con amigos en Cordón") sigue el camino de siempre.
- `search.ts`: con una frase de fila se busca como sin texto, sin modelo, embedding, palabras clave, nombre ni venues, y se ordena por calidad.
- Si nada cumple, se relaja como cualquier tag exigido: `mustTags` es el primer paso y hoy se relaja con **0** resultados. Hay test.
- Regla general de la barra: `showsInBar` en `labels.ts`, usada por `FilterBar`. Se ven los chips de la URL (tag de una fila, grupo, "Cerca de") y, del texto, sólo los que agregan información ("Hoy", "Esta noche", "Hoy al mediodía"). Hay test: "cenar hoy" sigue mostrando "Esta noche".
- `interpretationCacheVersion` 11 → **12**.

**Cambia al escribir la frase exacta sola** (lo charlamos):

| frase | antes | ahora |
|---|---|---|
| after office | preferencia | exigido (16 lugares) |
| algo rápido | preferencia | exigido (34) |
| juntada con amigos | preferencia | exigido (115) |
| salida en pareja | iba al modelo | exigido (109), sin modelo |

Merienda para 2 y menú del día ya eran exigidos.

### Verificación con datos reales

Cada fila de la home contra su "Ver todos", a las 09, 13, 17 y 21 h de Montevideo, con un cache que falla si alguien pide modelo o embedding:
- **0 lugares faltantes** y **0 llamadas pagas**.
- Ningún chip en las filas con texto; sólo "Comida del mundo" y "Clásicos uruguayos" en las de grupo.

`yarn search:eval` con las cinco frases: atajo del diccionario, costo US$ 0.

`yarn search:check` (con modelo y embeddings reales, interpretación v12): **54/54 OK**. Fueron al modelo 14 de 34 textos distintos. El modo `--check` no imprime el costo; medí una consulta ("algo barato para cenar": US$ 0,000216) y la estimación total es ≈ US$ 0,003. Salida: `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans-backoffice/0f51568d-0537-4946-9e92-1268db20aa6c/scratchpad/search-check.txt`.

Relajación: todo el resto de la búsqueda relaja sus filtros sólo cuando ningún candidato los cumple (`search.ts`, bucle de `RELAX_ORDER`). Las frases de fila usan ese mismo bucle. Los otros mínimos (8 para el radio de cerca mío, 12 para completar brunch, 12 para los grupos) no relajan filtros.

---

## Tests nuevos o cambiados

- `utils/test/sheet.test.ts`: `splitDrag` (tramos sin saltos, nunca debajo de la media), `releaseSnap` y `momentumStep`.
- `server/search/test/intents.test.ts`: tagWins (Comer › Brunch, Desayuno y Almuerzo suman cafés; Comer sola, Al aire libre y Cafés no; "menú del día" y "sándwiches" desde el texto).
- `server/search/test/row-phrases.test.ts` (nuevo): exige el tag, sin modelo, embedding ni keywords, sin chip; "after office" sin Bares; relaja con 0; "cenar hoy" → "Esta noche"; `showsInBar`.
- `server/home/test/home.test.ts`:
  - tabla fila → destino;
  - cada `text` es una frase de fila con los mismos tags;
  - "Ver todos = fila" con cafés y sin chips;
  - sin modelo ni embedding.
- `server/search/test/occasions.test.ts`: "algo rápido" y "juntada con amigos" solos pasan a ser frases de fila (exigidos); con más texto siguen como preferencia.

## Para probar a mano

1. En un celular (mejor un iPhone real), `/search?q=pizza&loc=all`: desde la media, scrollear la lista hacia arriba en un solo gesto. En la alta, con la lista arriba de todo, arrastrar hacia abajo.
2. En la home, los "Ver todos" de Brunch y Para desayunar (Comer › sub, con cafés), y los de Salida en pareja, Juntada con amigos, Merienda para 2, After office, Menú del día y Algo rápido (texto en el buscador, sin chip).
3. `/search?q=sándwiches`: mirar si Emporio de los Sándwiches primero te parece bien.
