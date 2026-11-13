"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Dialog as DialogBase } from "@base-ui/react/dialog";
import styles from "./Dialog.module.scss";

type Props = {
  open: boolean;
  /** Escape, el fondo o "Cerrar" piden cerrar con false. */
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Texto debajo del título (aria-describedby). */
  description?: string;
  /** El paso actual (en un diálogo de varios pasos): al cambiar, el foco va al título nuevo y el lector lo anuncia. */
  step?: string;
  /** Botones de abajo: quedan fijos mientras el contenido hace scroll. */
  footer?: ReactNode;
  children: ReactNode;
};

/**
 * Diálogo modal (Base UI): foco atrapado adentro y devuelto al cerrar, el resto de la página inerte, título y
 * descripción anunciados. Al abrir, el foco va al título. En mobile, panel desde abajo de casi toda la pantalla; desde
 * md, centrado.
 */
const Dialog = (props: Props) => {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(props.step);

  useEffect(() => {
    if (shownStep.current === props.step) return;
    shownStep.current = props.step;
    titleRef.current?.focus();
  }, [props.step]);

  return (
    <DialogBase.Root open={props.open} onOpenChange={(open) => props.onOpenChange(open)}>
      <DialogBase.Portal>
        <DialogBase.Backdrop className={styles.backdrop} />
        <DialogBase.Popup className={styles.popup} initialFocus={titleRef}>
          <div className={styles.header}>
            <DialogBase.Title ref={titleRef} tabIndex={-1} className={styles.title}>
              {props.title}
            </DialogBase.Title>
            {props.description && <DialogBase.Description className={styles.description}>{props.description}</DialogBase.Description>}
          </div>
          <div className={styles.body}>{props.children}</div>
          {props.footer && <div className={styles.footer}>{props.footer}</div>}
        </DialogBase.Popup>
      </DialogBase.Portal>
    </DialogBase.Root>
  );
};

export default Dialog;
