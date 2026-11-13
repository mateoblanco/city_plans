"use client";

import { useRef, type ReactNode } from "react";
import { Button } from "@base-ui/react/button";
import { Drawer } from "@base-ui/react/drawer";
import styles from "./ResultsSheet.module.scss";
import { resultsCountLabel, type NearbyCount } from "../../utils/results-count";
import { isTap, nextSnapPoint, SHEET_HIGH, SHEET_LOW, SHEET_MID, SHEET_SNAP_POINTS, toSnapPoint, type SheetSnapPoint } from "../../utils/sheet";

type Props = {
  /** Cuántos lugares trajo la búsqueda: el título del panel ("N lugares"). Mientras busca, null ("Buscando…"). */
  count: number | null;
  /** "Cerca de <barrio>": "18 lugares en Palermo · 6 cerca". */
  nearby: NearbyCount | null;
  /** Mientras busca: el título ("Buscando…" o "Buscando cerca tuyo…"). */
  pendingLabel?: string;
  snapPoint: SheetSnapPoint;
  onSnapPointChange: (snapPoint: SheetSnapPoint) => void;
  children: ReactNode;
};

/** Después de un intento de cierre, Base UI vuelve a avisar la altura anterior (~30 ms): se ignora en este lapso. */
const DISMISS_SETTLE_MS = 300;


/**
 * Los resultados de /search en mobile: un Drawer de Base UI siempre abierto y no modal (sin backdrop ni cierre al tocar
 * afuera), así el mapa de fondo se sigue usando. Tres alturas (utils/sheet): bajar del todo lo deja en la baja.
 * Drawer.Content es el área con scroll: Base UI decide entre scrollearla y arrastrar el panel (con el scroll arriba de
 * todo, arrastrar hacia abajo baja el panel). Un carrusel horizontal adentro llevaría data-base-ui-swipe-ignore.
 */
const ResultsSheet = (props: Props) => {
  const dismissing = useRef(false);
  // Dónde se apoyó el dedo (o el mouse) en la manija: si al soltar se movió, fue un arrastre del Drawer, no un toque.
  const pointerDown = useRef<{ x: number; y: number } | null>(null);
  const expanded = props.snapPoint === SHEET_HIGH;

  return (
    <Drawer.Root
      open
      modal={false}
      disablePointerDismissal
      // Nunca se cierra. Un swipe que lo cerraría (largo o rápido hacia abajo) avisa null y, unos milisegundos después,
      // al cancelarse el cierre, la altura de antes: lo deja en la baja e ignora lo que llega en ese lapso.
      // La lista scrollea en la media y en la alta: desde la media, el panel sube arrastrando la manija o el título; con
      // la lista arriba de todo, arrastrar hacia abajo sobre ella lo baja.
      onOpenChange={() => {}}
      snapPoints={SHEET_SNAP_POINTS}
      snapPoint={props.snapPoint}
      onSnapPointChange={(value) => {
        if (value === null) {
          dismissing.current = true;
          setTimeout(() => {
            dismissing.current = false;
          }, DISMISS_SETTLE_MS);
          props.onSnapPointChange(SHEET_LOW);
        } else if (!dismissing.current) {
          props.onSnapPointChange(toSnapPoint(value));
        }
      }}
    >
      <Drawer.Portal>
        <Drawer.Viewport className={styles.viewport}>
          <Drawer.Popup
            className={styles.popup}
            initialFocus={false}
            finalFocus={false}
            data-low={props.snapPoint === SHEET_LOW || undefined}
          >
            {/* La manija: se arrastra (Drawer) o se toca, con el dedo o con Enter/Espacio, para alternar entre la media y la
                alta (desde la baja, a la media). Lo que se ve es el ::after; el botón es más ancho y su ::before agranda
                el área táctil a 44px de alto sin mover nada. */}
            <Button
              className={styles.handle}
              aria-label={expanded ? "Contraer resultados" : "Expandir resultados"}
              aria-expanded={expanded}
              onPointerDown={(event) => {
                pointerDown.current = { x: event.clientX, y: event.clientY };
              }}
              onClick={(event) => {
                const tap = isTap(pointerDown.current, { x: event.clientX, y: event.clientY, detail: event.detail });
                pointerDown.current = null;
                if (tap) props.onSnapPointChange(nextSnapPoint(props.snapPoint));
              }}
            />
            <Drawer.Title className={styles.title}>{resultsCountLabel(props.count, props.nearby, props.pendingLabel)}</Drawer.Title>
            {/* Si el foco entra a la lista con el panel en la baja (Tab, "Ir a los resultados"), sube a la media: si no, se
                enfocaría algo invisible. */}
            <Drawer.Content
              className={styles.content}
              role="region"
              aria-label="Resultados"
              onFocus={() => {
                if (props.snapPoint === SHEET_LOW) props.onSnapPointChange(SHEET_MID);
              }}
            >
              {props.children}
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
};

export default ResultsSheet;
