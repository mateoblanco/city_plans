"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import {
  DRAG_DEAD_ZONE_PX,
  momentumStep,
  releaseSnap,
  SHEET_HIGH,
  SHEET_MID,
  splitDrag,
  type SheetSnapPoint,
} from "../../utils/sheet";

/** Lo que Base UI pone en el popup para cada altura (DrawerPopup: estilo inline, en el render). */
const SNAP_OFFSET_VAR = "--drawer-snap-point-offset";
/** Lo nuestro: cuánto se corrió el panel con el dedo, sumado al transform (ResultsSheet.module.scss). */
const DRAG_VAR = "--sheet-drag";
/** Sin transición mientras el dedo lo mueve (y hasta que Base UI aplique la altura nueva). */
const DRAGGING_ATTR = "data-dragging";
/** Si Base UI no aplica la altura nueva en este lapso, se suelta igual. */
const SETTLE_TIMEOUT_MS = 150;
/** Un último movimiento más viejo que esto al soltar: el dedo ya estaba quieto, sin inercia. */
const STALE_VELOCITY_MS = 80;

type Mode = "pending" | "sheet" | "list" | "off";
type Gesture = {
  mode: Mode;
  startX: number;
  startY: number;
  lastY: number;
  lastTime: number;
  /** px/ms del dedo (negativa = hacia arriba), suavizada. */
  velocity: number;
  /** Cuánto subió el panel desde la media (≤ 0). */
  drag: number;
  /** De la media a la alta, en px (el offset de la media: la alta es 0). */
  distance: number;
};

type Options = {
  popup: HTMLElement | null;
  content: HTMLElement | null;
  snapPoint: SheetSnapPoint;
  onSnapPointChange: (snapPoint: SheetSnapPoint) => void;
};

/**
 * Subir el panel scrolleando la lista (como las hojas de iOS o Google Maps). Base UI decide entre scrollear la lista y
 * arrastrar el panel, pero sobre una lista con scroll sólo toma el gesto hacia abajo con el scroll arriba de todo:
 * desde la media, el dedo hacia arriba scrolleaba la lista sin mover el panel. Esto toma ese caso y nada más:
 *
 * - En la media, el dedo hacia arriba sobre la lista mueve el panel (`--sheet-drag`). Al llegar a la alta, en el mismo
 *   gesto, el panel pasa a la alta y lo que sigue scrollea la lista a mano; al soltar, con inercia.
 * - Si se suelta antes, va a la alta o vuelve a la media (releaseSnap) con la transición de siempre (sin animación con
 *   movimiento reducido: ResultsSheet.module.scss).
 * - El resto (la manija, el título, la media hacia abajo, todo en la alta y la baja, la rueda y el teclado) sigue siendo
 *   de Base UI y del scroll nativo.
 *
 * Escucha en `window` en captura: llega antes que el listener de Base UI en `document`, y cuando toma el gesto lo
 * corta ahí (`stopPropagation`) para que Base UI no lo arrastre también. Mientras el panel cambia de altura, la posición
 * que se ve queda fija: cuando Base UI aplica el offset nuevo (MutationObserver sobre el estilo del popup), `--sheet-drag`
 * se recalcula en el mismo frame, así no salta.
 */
export function useScrollExpand({ popup, content, snapPoint, onSnapPointChange }: Options) {
  const snapRef = useRef(snapPoint);
  const changeRef = useRef(onSnapPointChange);
  useLayoutEffect(() => {
    snapRef.current = snapPoint;
    changeRef.current = onSnapPointChange;
  });

  // En la media la lista no se scrollea hacia arriba (el dedo sube el panel): si se bajó desde la alta con la lista
  // scrolleada (la manija), vuelve arriba de todo.
  const previous = useRef(snapPoint);
  useLayoutEffect(() => {
    if (previous.current === SHEET_HIGH && snapPoint === SHEET_MID) content?.scrollTo({ top: 0 });
    previous.current = snapPoint;
  }, [snapPoint, content]);

  useEffect(() => {
    if (!popup || !content) return;
    const win = content.ownerDocument.defaultView;
    if (!win) return;

    let gesture: Gesture | null = null;
    // La posición del panel que se quiere ver (offset + drag), mientras la manejamos nosotros; null: la de Base UI.
    let desired: number | null = null;
    // Soltamos hacia otra altura: se espera a que Base UI aplique su offset para devolverle el panel.
    let settling: { from: number; timer: number } | null = null;
    let momentum: number | null = null;

    const offsetNow = () => Number.parseFloat(popup.style.getPropertyValue(SNAP_OFFSET_VAR)) || 0;
    const apply = () => {
      if (desired === null) {
        popup.style.removeProperty(DRAG_VAR);
        return;
      }
      const value = `${desired - offsetNow()}px`;
      if (popup.style.getPropertyValue(DRAG_VAR) !== value) popup.style.setProperty(DRAG_VAR, value);
    };
    // Devuelve el panel a Base UI: con la transición encendida, va desde donde está a su altura.
    const handBack = () => {
      if (settling) win.clearTimeout(settling.timer);
      settling = null;
      desired = null;
      popup.removeAttribute(DRAGGING_ATTR);
      apply();
    };
    const observer = new MutationObserver(() => {
      if (settling && offsetNow() !== settling.from) handBack();
      else apply();
    });
    observer.observe(popup, { attributes: true, attributeFilter: ["style"] });

    const stopMomentum = () => {
      if (momentum !== null) win.cancelAnimationFrame(momentum);
      momentum = null;
    };
    const startMomentum = (fingerVelocity: number) => {
      let velocity = fingerVelocity;
      let last = win.performance.now();
      const frame = (time: number) => {
        const step = momentumStep(velocity, time - last);
        last = time;
        const max = content.scrollHeight - content.clientHeight;
        const next = step ? Math.min(max, Math.max(0, content.scrollTop - step.delta)) : content.scrollTop;
        content.scrollTop = next;
        // Frena sola o al llegar a un borde de la lista.
        if (!step || next <= 0 || next >= max) {
          momentum = null;
          return;
        }
        velocity = step.velocity;
        momentum = win.requestAnimationFrame(frame);
      };
      momentum = win.requestAnimationFrame(frame);
    };

    const changeSnap = (target: SheetSnapPoint) => {
      if (snapRef.current !== target) changeRef.current(target);
    };

    const release = () => {
      const current = gesture;
      gesture = null;
      if (!current || (current.mode !== "sheet" && current.mode !== "list")) return;
      const velocity = win.performance.now() - current.lastTime > STALE_VELOCITY_MS ? 0 : current.velocity;
      const target = current.mode === "list" ? SHEET_HIGH : releaseSnap(current.drag, current.distance, velocity);
      if (current.mode === "list" && velocity !== 0) startMomentum(velocity);
      const targetOffset = target === SHEET_HIGH ? 0 : current.distance;
      if (offsetNow() === targetOffset) {
        handBack();
        return;
      }
      // Hasta que Base UI aplique la altura nueva, el panel queda donde está (sin transición); después, la transición
      // lo lleva desde ahí.
      settling = { from: offsetNow(), timer: win.setTimeout(handBack, SETTLE_TIMEOUT_MS) };
      changeSnap(target);
    };

    const onTouchStart = (event: TouchEvent) => {
      stopMomentum();
      const touch = event.touches[0];
      const inside = event.target instanceof Node && content.contains(event.target);
      if (!touch || event.touches.length > 1 || !inside || snapRef.current !== SHEET_MID || settling) {
        gesture = null;
        return;
      }
      gesture = {
        mode: "pending",
        startX: touch.clientX,
        startY: touch.clientY,
        lastY: touch.clientY,
        lastTime: event.timeStamp,
        velocity: 0,
        drag: 0,
        distance: offsetNow(),
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!gesture || gesture.mode === "off") return;
      const touch = event.touches[0];
      if (!touch || event.touches.length > 1) {
        gesture.mode = gesture.mode === "pending" ? "off" : gesture.mode;
        return;
      }
      if (gesture.mode === "pending") {
        const totalX = touch.clientX - gesture.startX;
        const totalY = touch.clientY - gesture.startY;
        if (Math.max(Math.abs(totalX), Math.abs(totalY)) < DRAG_DEAD_ZONE_PX) return;
        // Hacia arriba y más vertical que horizontal: es del panel. Si no (abajo, o un carrusel), del navegador y Base UI.
        if (totalY >= 0 || Math.abs(totalY) < Math.abs(totalX) || gesture.distance <= 0) {
          gesture.mode = "off";
          return;
        }
        gesture.mode = "sheet";
        popup.setAttribute(DRAGGING_ATTR, "");
      }
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();

      const delta = touch.clientY - gesture.lastY;
      const elapsed = event.timeStamp - gesture.lastTime;
      if (elapsed > 0) gesture.velocity = 0.8 * (delta / elapsed) + 0.2 * gesture.velocity;
      gesture.lastY = touch.clientY;
      gesture.lastTime = event.timeStamp;

      if (gesture.mode === "sheet") {
        const step = splitDrag(gesture.drag, delta, gesture.distance);
        gesture.drag = step.drag;
        desired = gesture.distance + step.drag;
        apply();
        if (step.drag === -gesture.distance) {
          // Llegó a la alta: el panel pasa a la alta en el mismo gesto y lo que sobra scrollea la lista.
          gesture.mode = "list";
          changeSnap(SHEET_HIGH);
          content.scrollTop += step.overflow;
        }
      } else {
        content.scrollTop -= delta;
      }
    };

    const listen = { capture: true } as const;
    win.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    win.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    win.addEventListener("touchend", release, listen);
    win.addEventListener("touchcancel", release, listen);
    return () => {
      win.removeEventListener("touchstart", onTouchStart, listen);
      win.removeEventListener("touchmove", onTouchMove, listen);
      win.removeEventListener("touchend", release, listen);
      win.removeEventListener("touchcancel", release, listen);
      observer.disconnect();
      stopMomentum();
      if (settling) win.clearTimeout(settling.timer);
      popup.removeAttribute(DRAGGING_ATTR);
      popup.style.removeProperty(DRAG_VAR);
    };
  }, [popup, content]);
}
