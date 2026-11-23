"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { Dialog as DialogBase } from "@base-ui/react/dialog";
import Close from "@/assets/close.svg";
import Button from "@/components/base/Button/Button";
import { guidePlaceId, scrollToGuidePlace } from "../../utils/place-anchor";
import type { GuidePin } from "../../utils/pins";
import styles from "./GuideMapDialog.module.scss";

// El chunk del mapa (y Maps JS) se baja recién al abrir por primera vez.
const GuideMap = dynamic(() => import("../GuideMap/GuideMap"), { ssr: false });

type Props = {
  pins: GuidePin[];
};

/**
 * Mobile (debajo de md): botón "Ver mapa" fijo abajo que abre el mapa a pantalla completa con los mismos pins
 * numerados (Base UI Dialog: foco atrapado, Escape cierra y el foco vuelve al botón). Tocar un pin cierra y lleva a ese
 * lugar de la lista, con el foco ahí. El mapa se crea al abrir por primera vez y queda montado (oculto) para no pagar
 * otro mapa cada vez que se abre.
 */
const GuideMapDialog = (props: Props) => {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const selected = useRef<string | null>(null);

  const show = () => {
    selected.current = null;
    setOpened(true);
    setOpen(true);
  };

  const select = (id: string) => {
    selected.current = id;
    setOpen(false);
  };

  return (
    <>
      <span ref={triggerRef} className={styles.trigger}>
        <Button type="button" variant="primary" size="md" label="Ver mapa" onClick={show} touchTarget />
      </span>
      <DialogBase.Root open={open} onOpenChange={setOpen} onOpenChangeComplete={(isOpen) => {
        // Ya cerrado (y con el scroll de la página devuelto): recién ahí se lleva el lugar a la vista.
        if (!isOpen && selected.current) scrollToGuidePlace(selected.current);
      }}>
        <DialogBase.Portal keepMounted={opened}>
          <DialogBase.Popup
            className={styles.popup}
            finalFocus={() =>
              (selected.current && document.getElementById(guidePlaceId(selected.current))) || triggerRef.current?.querySelector("button") || true
            }
          >
            <div className={styles.bar}>
              <DialogBase.Title className={styles.title}>Mapa de la guía</DialogBase.Title>
              <Button type="button" variant="tertiary" size="sm" onlyIcon label="Cerrar mapa" icon={<Close aria-hidden />} onClick={() => setOpen(false)} touchTarget />
            </div>
            <div className={styles.map}>{opened && <GuideMap pins={props.pins} onSelect={select} gestureHandling="greedy" />}</div>
          </DialogBase.Popup>
        </DialogBase.Portal>
      </DialogBase.Root>
    </>
  );
};

export default GuideMapDialog;
