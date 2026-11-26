"use client";

import { useEffect, type RefObject } from "react";
import { freezeWhileResizing } from "./utils/frozen-size";

/**
 * Mientras el recuadro (`box`) cambia de tamaño, el mapa (`frame`) se queda con el que tenía y toma el nuevo cuando el
 * recuadro se queda quieto (freezeWhileResizing). Sólo con el mapa montado (`active`).
 *
 * El ResizeObserver se crea antes que el de Maps JS (que monta después, adentro de `frame`): en cada frame corre primero
 * este, fija `frame`, y el de Google ya no ve ningún cambio.
 */
export function useFrozenSize(box: RefObject<HTMLElement | null>, frame: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const boxElement = box.current;
    const frameElement = frame.current;
    if (!active || !boxElement || !frameElement) return;
    return freezeWhileResizing({
      observe: (onSize) => {
        const observer = new ResizeObserver((entries) => {
          const rect = entries[entries.length - 1].contentRect;
          onSize({ width: rect.width, height: rect.height });
        });
        observer.observe(boxElement);
        return () => observer.disconnect();
      },
      apply: (size) => {
        frameElement.style.width = size ? `${size.width}px` : "";
        frameElement.style.height = size ? `${size.height}px` : "";
      },
      wait: (run, ms) => {
        const id = setTimeout(run, ms);
        return () => clearTimeout(id);
      },
    });
  }, [box, frame, active]);
}
