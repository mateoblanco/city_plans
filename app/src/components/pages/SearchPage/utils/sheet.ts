/**
 * Alturas del panel de resultados de /search en mobile (ResultsSheet). Al volver desde la ficha no hace falta guardar
 * nada: con cacheComponents, Next conserva el estado de la página anterior (altura, scroll, card flotante).
 */

/**
 * Sólo la manija y "N lugares" (~53px) más lugar para la barra de inicio de iOS. La card flotante del marcador
 * (SelectedPlace.module.scss) va 12px arriba de esta altura y el mapa (MapColumn.module.scss) termina en ella: si
 * cambia, cambia allá también.
 */
export const SHEET_LOW = "104px";
/** La mitad de la pantalla: arranca acá. */
export const SHEET_MID = 0.5;
/** Toda la pantalla: el popup mide hasta el header, así que queda justo debajo. */
export const SHEET_HIGH = 1;

export const SHEET_SNAP_POINTS = [SHEET_LOW, SHEET_MID, SHEET_HIGH];

export type SheetSnapPoint = typeof SHEET_LOW | typeof SHEET_MID | typeof SHEET_HIGH;

/** Lo que devuelve el Drawer como una de las tres alturas; cualquier otra cosa (cerrar), la baja. */
export const toSnapPoint = (value: unknown): SheetSnapPoint =>
  (SHEET_SNAP_POINTS.find((point) => Object.is(point, value)) as SheetSnapPoint | undefined) ?? SHEET_LOW;

/** La manija como botón (WCAG 2.5.7, sin arrastrar): de la media a la alta y de la alta a la media; desde la baja, a la media. */
export const nextSnapPoint = (current: SheetSnapPoint): SheetSnapPoint => (current === SHEET_MID ? SHEET_HIGH : SHEET_MID);

/** Más que esto entre que se apoya y se suelta, fue un arrastre (lo maneja el Drawer), no un toque. */
export const TAP_SLOP_PX = 8;

/** ¿El click de la manija fue un toque (o teclado) y no el final de un arrastre? */
export const isTap = (down: { x: number; y: number } | null, up: { x: number; y: number; detail: number }) =>
  up.detail === 0 || down === null || Math.hypot(up.x - down.x, up.y - down.y) <= TAP_SLOP_PX;

// Subir el panel scrolleando la lista (ResultsSheet/use-scroll-expand.ts). Base UI sólo toma el arrastre de la lista
// hacia abajo con el scroll arriba de todo; desde la media, el dedo hacia arriba sobre la lista mueve el panel hasta la
// alta y, en el mismo gesto, lo que sobra scrollea la lista (como las hojas de iOS o Google Maps).

/** Hasta esto de movimiento no se decide si el gesto es del panel o un toque (el navegador tampoco scrollea antes). */
export const DRAG_DEAD_ZONE_PX = 4;
/** Soltar más rápido que esto (px/ms, ~500 px/s) decide por la dirección, no por la distancia. */
export const FLICK_VELOCITY = 0.5;
/** Inercia de la lista al soltar: cuánto de la velocidad queda cada 16 ms y por debajo de qué se frena. */
export const MOMENTUM_FRICTION = 0.95;
export const MOMENTUM_MIN_VELOCITY = 0.02;

/**
 * Un tramo del arrastre desde la media. drag: cuánto subió el panel desde la media (≤ 0, en px); delta: lo que se movió
 * el dedo (negativo = hacia arriba); distance: de la media a la alta. El panel se mueve hasta la alta y lo que sobra
 * (overflow, en px, ≥ 0) es scroll de la lista. Nunca baja de la media por acá.
 */
export function splitDrag(drag: number, delta: number, distance: number): { drag: number; overflow: number } {
  const next = drag + delta;
  if (next <= -distance) return { drag: -distance, overflow: -distance - next };
  return { drag: Math.min(0, next), overflow: 0 };
}

/**
 * A qué altura va el panel al soltar el arrastre antes de llegar a la alta: rápido, por la dirección (velocity en
 * px/ms, negativa = hacia arriba); lento, a la más cercana.
 */
export function releaseSnap(drag: number, distance: number, velocity: number): typeof SHEET_MID | typeof SHEET_HIGH {
  if (velocity <= -FLICK_VELOCITY) return SHEET_HIGH;
  if (velocity >= FLICK_VELOCITY) return SHEET_MID;
  return -drag >= distance / 2 ? SHEET_HIGH : SHEET_MID;
}

/**
 * Un frame de inercia: cuánto se mueve el contenido (delta = velocidad × tiempo, en px, con el signo del dedo) y la
 * velocidad que queda. null cuando ya casi no se mueve.
 */
export function momentumStep(velocity: number, dt: number): { delta: number; velocity: number } | null {
  if (Math.abs(velocity) < MOMENTUM_MIN_VELOCITY || dt <= 0) return null;
  return { delta: velocity * dt, velocity: velocity * MOMENTUM_FRICTION ** (dt / 16) };
}
