"use client";

import { useRef, type ReactNode } from "react";
import { Drawer } from "@base-ui/react/drawer";
import styles from "./ResultsSheet.module.scss";
import { SHEET_LOW, SHEET_SNAP_POINTS, toSnapPoint, type SheetSnapPoint } from "../../utils/sheet";

type Props = {
  /** Cuántos lugares trajo la búsqueda: el título del panel ("N lugares"). */
  count: number;
  snapPoint: SheetSnapPoint;
  onSnapPointChange: (snapPoint: SheetSnapPoint) => void;
  children: ReactNode;
};

/** Después de un intento de cierre, Base UI vuelve a avisar la altura anterior (~30 ms): se ignora en este lapso. */
const DISMISS_SETTLE_MS = 300;

const countLabel = (count: number) => (count === 1 ? "1 lugar" : `${count.toLocaleString("es-UY")} lugares`);

/**
 * Los resultados de /search en mobile: un Drawer de Base UI siempre abierto y no modal (sin backdrop ni cierre al tocar
 * afuera), así el mapa de fondo se sigue usando. Tres alturas (utils/sheet): bajar del todo lo deja en la baja.
 * Drawer.Content es el área con scroll: Base UI decide entre scrollearla y arrastrar el panel (con el scroll arriba de
 * todo, arrastrar hacia abajo baja el panel). Un carrusel horizontal adentro llevaría data-base-ui-swipe-ignore.
 */
const ResultsSheet = (props: Props) => {
  const dismissing = useRef(false);

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
            <div className={styles.handle} aria-hidden />
            <Drawer.Title className={styles.title}>{countLabel(props.count)}</Drawer.Title>
            <Drawer.Content className={styles.content}>
              {props.children}
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
};

export default ResultsSheet;
