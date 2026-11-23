# Guías: entradas desde la home y la ficha, "Más guías" y revisión de mobile

Nada está commiteado. No toqué `search-href.ts`, `labels.ts` ni `PlaceCard.module.scss`. No hay migraciones.

**En la base hay una sola guía publicada** ("primera-cita", de toda la ciudad, 10 lugares). Con eso:
- **"Más guías"** no aparece en ninguna guía. Está probado con tests, pero no lo vi en pantalla.
- **La sección de la home** muestra un solo link.

Cuando publiques 3 o 4 guías más (algunas del mismo grupo y con barrio), saco de nuevo esas capturas.

## 1. Sección "Guías" en la home

- **Dónde:** al final de la home, dentro del mismo `Suspense` que las filas y después de ellas. No aparece antes que las filas ni las corre.
- **Qué guías:** todas las publicadas con página, hasta 10. Primero las destacadas (`featured`) y después de la más reciente a la más vieja.
- **Cómo se ve** (ajustado después de tu revisión):
  - el título "Guías" lleva a `/guides/montevideo`, con el botón de la flecha al lado, igual que los grupos de la home. La flecha tiene área táctil de 44 px;
  - debajo, links de texto con el título de cada guía y, si tiene barrio, el barrio en chico. Ya no muestran la cantidad de lugares, y una guía sin barrio va sólo con el título;
  - sin logos ni tarjetas;
  - una columna en mobile y dos desde 768 px;
  - cada link mide al menos 44 px de alto.
- **Sin botón "Ver todas las guías":** lo reemplazó la flecha del título.
- **Sin guías publicadas:** la sección no aparece.
- **Cache:** igual para todos. `getHomeGuides` usa `'use cache'` (horas, tag `guides`) sobre la lista de guías que ya estaba cacheada. Para que no haga falta otra consulta, la consulta de guías ahora trae también la cantidad de lugares publicados de cada una (`publishedPlaces`). No lee cookies y no suma consultas por pedido.

## 2. "Aparece en estas guías" en la ficha

- **Dónde:** en la columna principal, justo después de los descuentos, como pediste. En mobile queda antes de contacto y horarios.
- **Qué:** las guías publicadas con página que incluyen el lugar, cada una como link con su título y de 44 px de alto. Sin guías, no se muestra.
- **Datos:** sólo de la base, sin Google. `getPlaceGuides` está cacheada y sale de la misma lista de guías. Se espera junto con los descuentos, sin `Suspense` aparte: no aparece después ni mueve lo de abajo (CLS 0 en mobile).

## 3. "Más guías" al final de cada guía

- **Qué guías:** hasta 4 publicadas, sin la actual. Primero las del mismo grupo, después las del mismo barrio (si las dos tienen barrio y es el mismo), después las más recientes. Si hay menos, las que haya.
- **Cómo se ve:** con `GuideRow` y `GuideCard`, la fila de tarjetas que ya existía: scroll horizontal en mobile y grilla desde 768 px.
- **Datos:** los lugares de la guía y de las relacionadas salen en la misma consulta de antes, sin una consulta extra.
- **Sin otras guías:** no aparece. Hoy es el caso, con una sola publicada.
- **En mobile:** queda por encima del botón fijo "Ver mapa" (la página deja 96 px abajo).

## 4. Revisión de mobile (375 y 414 px)

Con Playwright contra la app local, en cada página medí tres cosas:
- desborde horizontal (`scrollWidth` contra `clientWidth`);
- controles de menos de 44 px. El área efectiva la medí tocando con `elementFromPoint` a 21 px del centro, porque eso cuenta lo que cubre un pseudo-elemento y `getBoundingClientRect` no;
- textos de menos de 12 px.

**Desbordes: ninguno** en `/guides/montevideo`, la guía, el mapa a pantalla completa, la sección de la home ni la ficha.

**Arreglado (áreas táctiles de menos de 44 px):**

| Control | Antes | Ahora |
|---|---|---|
| Link "Guías de Montevideo" de las migas | 132×18 | 18 visible, área de 44 de alto (`::after` del link) |
| Corazón de cada lugar de la guía | 24×24 | 24 visible, área de 44×44 |
| "Ver mapa" | 94×34 | 34 visible, área de 44 de alto |
| "Cerrar mapa" | 24×24, a 8 px de la esquina (el área se salía de la pantalla) | 24 visible, área de 44×44 entera: el encabezado del mapa pasa a 10 px de padding |

**Cómo se arregló:**
- Sumé al `Button` base una opción **`touchTarget`**: un `::after` invisible centrado de al menos 44×44, por encima de lo que viene después, que no cambia cómo se ve.
- Es opcional y hoy sólo la usan las partes de guías y la flecha de "Guías" en la home. El resto de la app no cambia.
- Para el corazón, `SaveButton` y `CardToggle` reciben la opción y se la pasan al botón. No toqué `PlaceCard.module.scss`, y las cards de `/search` y la home siguen igual.

**Revisado y sin cambios:**
- **Tarjetas:** el nombre de cada lugar de la guía (23 px de alto) y las tarjetas de guía de `/guides/montevideo` miden poco, pero toda la tarjeta es el link: el área real es la tarjeta entera.
- **Mapa:** al cerrarlo, el foco vuelve a "Ver mapa".
- **Textos chicos:** los únicos de menos de 12 px son la atribución y los términos de Google dentro del mapa, que no son nuestros.
- **Fuera de las partes de guías,** en la ficha hay controles de 24 a 34 px que ya estaban: "Volver", "Guardar", el puntaje de Google, "Ómnibus cerca", "Ver todos los horarios" y los nombres de "Parecidos". Los dejé como estaban, porque la revisión era de las secciones de guías. Si querés, los paso a 44 con el mismo `touchTarget`.

## Capturas

Están en `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans/9d3a7bca-d9b1-4901-ac8f-41d53f48afb5/scratchpad/mobile/`, con el sufijo `w375`, `w414` o `w1440`:
- `home-guias-*`: la sección de la home;
- `ficha-*`: la ficha de Matute con "Aparece en estas guías";
- `guia-*` y `guia-mapa-*`: la guía y el mapa a pantalla completa;
- `ciudad-*`: `/guides/montevideo`.

Las mediciones están en `report.json`, en la misma carpeta.

## Lighthouse

> **Corregido.** La primera versión de esta sección daba la home mobile en 73 / LCP 5,5 s y decía que era "previo". Las dos cosas estaban mal. Era **una sola corrida**, con el servidor recién levantado después del build, y el navegador tuvo una tarea larga propia de 346 ms antes del primer pintado. No vino de ningún script nuestro, y Lighthouse la simuló como 1,4 s a 4× CPU. Lo que bajó la página era idéntico a lo de las demás corridas: el mismo HTML, los mismos 330 KB de JS y los mismos 84 pedidos. Medida bien, la home da 91–92, igual que en el diagnóstico.

**Cómo se midió:** la configuración de `REPORTE-diagnostico-rendimiento.md`:
- build de producción (`yarn build` + `yarn start`);
- Lighthouse 12.8.2 por defecto: mobile como Moto G Power, 4× CPU, 4G lento simulado; desktop con `--preset=desktop`;
- **3 corridas por página, la mediana**, con el servidor caliente: cada página se pidió dos veces antes de medir.

**Performance:**

| Página | Modo | Perf (3 corridas) | LCP (3 corridas) | LCP mediana | FCP | Elemento del LCP |
|---|---|---|---|---|---|---|
| Home | Mobile | 91, 92, 91 | 3.288 / 3.291 / 3.362 ms | **3,29 s** | 1,7 s | primera foto de Platos (`DishCard`) |
| Home | Desktop | 100, 100, 99 | 683 / 685 / 751 ms | **0,69 s** | 0,5 s | ídem |
| Guía (primera-cita) | Mobile | 91, 91, 90 | 3.321 / 3.342 / 3.496 ms | **3,34 s** | 1,7 s | un párrafo de la intro |
| Guía (primera-cita) | Desktop | 99, 99, 99 | 663 / 663 / 796 ms | **0,66 s** | 0,5 s | ídem |
| Ficha (Matute) | Mobile | 91, 89, 86 | 3.370 / 3.647 / 4.018 ms | **3,65 s** | 1,7 s | la imagen de Static Maps |
| Ficha (Matute) | Desktop | 95, 94, 94 | 1.415 / 1.526 / 1.568 ms | **1,53 s** | 0,5 s | — |

**Comparación con el commit del diagnóstico (`12c1428`).** Lo armé en un worktree aparte y medí la home mobile igual, en la misma sesión: 94, 92, 92 y LCP de 3,21 s. Hoy da 3,29 s, con 10 KB más de JS (330 contra 321 KB, 23 scripts contra 21). Son unos 80 ms en la simulación, dentro de lo que varían las propias corridas del commit base (2,93 a 3,21 s). No es una regresión que valga perseguir.

**La ficha mobile varía más** (3,4 a 4,0 s) porque su LCP es la imagen de Static Maps, que la pide el navegador a Google y tarda distinto en cada carga.

**Accesibilidad, buenas prácticas y SEO** son de una sola corrida con las 4 categorías. Esos puntajes no dependen de la carga:

| Página | Accesibilidad | Buenas prácticas | SEO |
|---|---|---|---|
| Home | 96 | 96 | 66 |
| Guía (primera-cita) | 100 | 96 | 69 |
| Ficha (Matute) | 96 | 96 | 58 |

- **Accesibilidad 96 en la home y la ficha:** el contraste del chip de Itaú de los descuentos (`BankChip`, `data-provider="itau"`). Ya estaba antes de esta tanda.
- **SEO:** baja por el `noindex` (`ALLOW_INDEXING` apagado).
- **Buenas prácticas 96:** los scripts de Vercel Analytics y Speed Insights, que en local dan 404.
- **motion:** el paquete completo no está en el bundle de la home (salió en la tanda de rendimiento). Lo único es `motion/mini` (`animate` de `FilterReveal`, el plegado de los filtros), adentro de un chunk compartido.

Las secciones nuevas no aparecen en ninguna auditoría.

## Tests

**App: 111 archivos y 1764 tests OK.** `tsc --noEmit` y `eslint` limpios. El backoffice no cambió.

- **`server/guides/test/entries.test.ts`, nuevo:**
  - **orden de la home:** destacadas en el orden de la lista y después las recientes;
  - **tope:** 10 sobre 14;
  - **sólo con página:** sin borradores ni guías sin lugares publicados;
  - **vacío:** sin guías, la sección se oculta;
  - **datos de cada link:** URL, barrio y cantidad;
  - **guías de un lugar:** sólo publicadas con página;
  - **relacionadas:** sin la actual, en el orden pedido y con tope de 4. Con pocas, las que haya; sin otras, vacío. Una guía de toda la ciudad no "comparte barrio" con otra de toda la ciudad.
- **`data.test.ts`, contra la base falsa:**
  - la home desde la base, vacía sin guías;
  - la ficha sólo con guías publicadas;
  - "Más guías" sin la actual, como tarjetas, con una sola consulta de lugares.
- **`HomePage/HomeGuides/test/HomeGuides.test.ts`, render con `react-dom/server`:**
  - la sección vacía no se dibuja;
  - el título y la flecha llevan a todas las guías; cada link lleva el título y el barrio, sin cantidad ni imágenes;
  - "Aparece en estas guías" vacía no se dibuja.
- **Guard test:** los datos nuevos de home y ficha están cacheados ('use cache' horas, tag `guides`).

## Pendiente

- **Con más guías publicadas:** volver a sacar las capturas de "Más guías" y de la home con varias guías, y mirar el scroll horizontal de "Más guías" en mobile.
