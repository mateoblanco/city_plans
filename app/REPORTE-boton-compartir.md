# Botón "Compartir" en la ficha

Sin commit: todo queda en el árbol de trabajo para que lo pruebes. `PlaceCard.module.scss` no se tocó. Va sin ícono, como pediste: el botón es solo texto y el ícono se agrega después con el prop `icon` (ver al final).

## Qué hace

**Dónde**: en la cabecera de la ficha, a la izquierda de "Guardar". "Guardar" no se movió: sigue en el borde derecho. El estilo es el mismo botón (`secondary`, `md`). Solo está en la ficha: las guías no usan `PlaceHeader`.

**Pantalla táctil** (mobile, tablet):
- Con Web Share API, abre el menú nativo con `{ title: <nombre del lugar>, url: https://www.adondevamos.com.uy/place/<slug> }`, sin parámetros ni hash. El título es el nombre (el h1 de la ficha), no el título largo de la pestaña.
- Sin Web Share API, copia la URL y muestra "Link copiado" debajo del botón durante 2,5 s.
- Si la persona cierra el menú nativo sin compartir (`AbortError`), no pasa nada: ni aviso ni copia.
- Si el menú nativo falla por otro motivo (por ejemplo `NotAllowedError`), copia la URL para que el botón siempre haga algo.
- Si no se puede copiar (sin portapapeles o sin permiso), muestra "No se pudo copiar el link".

**Mouse o trackpad** (desktop, `(hover: hover) and (pointer: fine)`, el mismo criterio que el mixin `hover`): un menú chico debajo del botón, alineado a su derecha, con dos opciones:
- "Copiar link": copia la URL y muestra "Link copiado".
- "WhatsApp": abre `https://wa.me/?text=<nombre> <URL>` en otra pestaña.

El menú se maneja con teclado (Enter o Espacio abre, flechas, Enter elige) y se cierra con Escape o con un click afuera. Al cerrarse, el foco vuelve al botón. Es el Menu de Base UI con `modal={false}`, así que no bloquea el scroll de la página.

**Accesibilidad**:
- Es un `<button>` real con nombre accesible "Compartir". En desktop, Base UI le agrega `aria-haspopup="menu"` y `aria-expanded`.
- El aviso va en `<span role="status" aria-live="polite">`. Está siempre en el DOM, vacío, para que el lector de pantalla lo conozca antes de que cambie.
- El área táctil es de 44 px, con `touchTarget` del botón base: el botón mide 34 px de alto y el `::after` llega a 44.

## Peso

Medido con el build de producción (`yarn build && yarn start`), el servidor en caliente y 3 corridas por caso (las 3 dieron los mismos bytes). Es la suma del JS de la ficha `/place/bar-hispano`, comprimido por la red. La base es el mismo árbol sin el botón (sin su import).

| | Sin el botón | Con el botón | Diferencia |
|---|---|---|---|
| Mobile (375, táctil) | 233.966 B | 236.602 B | **+2,6 KB** |
| Desktop (1280, mouse) | 285.914 B | 287.203 B | **+1,3 KB** |
| Desktop, al pasar el mouse por "Compartir" | — | +21.212 B | **+21,2 KB** (2 archivos, una vez) |

La primera versión importaba el Menu directo y sumaba **+21,6 KB** a toda ficha. Por eso el menú quedó en su propio componente (`ShareMenu`), que se baja recién cuando el mouse pasa por el botón o el botón recibe foco:
- Mobile no lo baja nunca.
- Si alguien hace click antes de que llegue (en la prueba hubo que forzarlo sin pasar el mouse), el menú se abre apenas llega.
- Si el botón tenía el foco, lo conserva al pasar a ser el botón del menú.

## Archivos

Nuevos:
- `src/components/pages/PlacePage/PlaceHeader/ShareButton/ShareButton.tsx` + `.module.scss`: la isla de cliente, el botón y el aviso.
- `src/components/pages/PlacePage/PlaceHeader/ShareButton/ShareMenu/ShareMenu.tsx` + `.module.scss`: el menú de desktop, en su propio chunk.
- `src/components/pages/PlacePage/utils/share.ts`: lógica pura. `placeShareUrl`, `whatsappShareHref`, `shareOrCopy`, `copyLink` y `shareMessage`.
- `src/components/pages/PlacePage/utils/test/share.test.ts`.

Modificados:
- `src/components/base/Button/Button.tsx`: exporta `buttonClassName(...)`, las clases del botón, para que el `Menu.Trigger` de Base UI se vea igual sin ser este componente. `Button` usa la misma función, así que no cambia nada para el resto.
- `PlaceHeader.tsx`: recibe `slug` y monta `ShareButton`. Sigue siendo componente de servidor.
- `PlacePage.tsx`: le pasa `slug` a `PlaceHeader`.
- `AGENTS.md`: una frase en "Ficha de lugar". Tenía cambios tuyos sin commitear; solo toqué esa frase.

## Verificación

- `yarn tsc --noEmit`: sin errores.
- `yarn lint`: sin errores.
- `yarn test`: 117 archivos, 1811 tests, todos pasan. Los nuevos, en `share.test.ts`, cubren:
  - la URL canónica absoluta sin parámetros ni hash;
  - con `navigator.share`: lo llama solo con `{ title, url }` y no copia;
  - cancelación (`AbortError`): devuelve "cancelled", sin aviso y sin copiar;
  - otro error del menú nativo: copia;
  - sin `navigator.share`: copia la URL canónica y avisa "Link copiado";
  - portapapeles que falla: "No se pudo copiar el link";
  - el link de WhatsApp, codificado.
- En el navegador (Playwright contra el build de producción, en 3 fichas: con barra de color, con barra blanca y con un nombre largo), todo OK:
  - desktop: menú con las dos opciones, WhatsApp con `target="_blank"` y el texto correcto, copia, aviso que se va solo, el menú se cierra al elegir y con click afuera;
  - teclado: se llega con Tab, Enter abre, las flechas mueven, Escape cierra y el foco vuelve al botón;
  - mobile con `navigator.share` simulado: lo llama con nombre y URL canónica; al cancelar, ni aviso ni errores;
  - mobile sin `navigator.share`: copia y avisa;
  - a 375 px, "Compartir" (x 135–231) y "Guardado" (x 239–359) quedan en la misma fila y dentro del margen de 16 px.

## Capturas

En `/private/tmp/claude-501/-Users-mateoblanco-Desktop-Projects-city-plans/fdb42d49-418f-40e0-a41d-c001b137c30a/scratchpad/shots/` (carpeta temporal, fuera del repo):
- `desktop-bar-hispano.png`, `desktop-menu-bar-hispano.png` (menú abierto), `desktop-copied-26-sushi-co.png` ("Link copiado"), `desktop-focus-bar-hispano.png` (foco por teclado).
- `mobile-bar-hispano.png`, `mobile-saved-cafelino-cafe-adoption-center.png` (con "Guardado", el caso más ancho), `mobile-copied-cafelino-cafe-adoption-center.png`.
- Las de antes del cambio empiezan con `before-`.

## Para que decidas

1. **El foco casi no se ve en los botones oscuros.** El botón base pinta el foco con `--color-control-focus` (neutral-950) y `outline-offset: -1px`: un contorno casi negro por dentro de un botón casi negro. Existe (`:focus-visible`), pero apenas cambia el borde (ver `desktop-focus-…png`). A "Guardar" le pasa lo mismo desde antes. Arreglarlo es tocar `Button.module.scss`, por ejemplo con offset positivo para que el anillo quede afuera, y eso cambia todos los botones. No lo toqué.
2. **Ícono**: cuando lo agregues en `src/assets`, se pone con `icon={<Share aria-hidden />}` en el `Button` de `ShareButton.tsx` y como primer hijo del `Menu.Trigger` en `ShareMenu.tsx`. Si va en muchas cards, AGENTS.md pide máscara de CSS en `public/icons/`; acá aparece una sola vez, así que SVGR está bien.
3. **Sin evento de popularidad**: no agregué un evento `share` a `/shared/events.ts`, porque cambia el esquema compartido con el backoffice. Si lo querés, se suma junto a `save` y `unsave`.

## Visto de paso (no lo toqué)

- En 26-sushi-co, a 375 px, el chip "Itaú Personal Bank" de la sección Descuentos (`BankChip`) llega a 402 px y produce scroll horizontal. No es de la cabecera.
- `PlaceSummary.module.scss` reserva 132 px a la derecha del título en mobile para "Guardar", pero en la cabecera el `position: absolute` de `.like` está comentado y los botones van en la fila del logo. Esa reserva parece sobrar, y en la ficha de Cafelino el título baja de línea antes de lo necesario. AGENTS.md también dice "el título deja 80px".
