"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Share from "@/assets/share.svg";
import Button from "@/components/base/Button/Button";
import { shareMessage, shareOrCopy, type ShareResult } from "../../utils/share";
import type ShareMenuType from "./ShareMenu/ShareMenu";
import styles from "./ShareButton.module.scss";

type Props = {
  /** El título que se comparte (el nombre del lugar, el h1 de la ficha). */
  title: string;
  /** La URL canónica absoluta (`placeShareUrl`). */
  url: string;
};

// Mouse o trackpad: lo mismo que el mixin `hover` de _breakpoints.scss.
const FINE_POINTER = "(hover: hover) and (pointer: fine)";
const MESSAGE_MS = 2500;

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(FINE_POINTER);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

/**
 * "Compartir" de la ficha (ícono y texto; en mobile, sólo el ícono), al lado de "Guardar". Con pantalla táctil, el menú nativo (Web Share API) con el título y la
 * URL canónica; sin él, copia la URL. Con mouse o trackpad (desktop), el menú de ShareMenu ("Copiar link" y "WhatsApp"),
 * en su propio chunk, que se baja recién con el mouse encima o el foco en el botón (mobile nunca lo baja); un click antes
 * de que llegue lo abre apenas llega. "Link copiado" sale unos segundos debajo, en una región viva. Cerrar el menú nativo
 * sin compartir no avisa nada.
 */
const ShareButton = (props: Props) => {
  const finePointer = useSyncExternalStore(subscribe, () => window.matchMedia(FINE_POINTER).matches, () => false);
  const [menu, setMenu] = useState<{ Component: typeof ShareMenuType; focus: boolean } | null>(null);
  // Click antes de que llegara el menú: se abre apenas llega.
  const [openOnLoad, setOpenOnLoad] = useState(false);
  const [message, setMessage] = useState("");
  const wrapper = useRef<HTMLDivElement>(null);
  const loading = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // El menú se baja con la intención (mouse encima o foco), no con la página.
  const loadMenu = () => {
    if (!finePointer || loading.current) return;
    loading.current = true;
    void import("./ShareMenu/ShareMenu").then((module) => {
      // Si el botón tenía el foco, lo toma el del menú (el botón se reemplaza).
      const focus = !!wrapper.current?.contains(document.activeElement);
      setMenu({ Component: module.default, focus });
    });
  };

  const announce = (result: ShareResult) => {
    const text = shareMessage(result);
    if (!text) return;
    setMessage(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(""), MESSAGE_MS);
  };

  return (
    <div className={styles.share} ref={wrapper} onPointerEnter={loadMenu} onFocus={loadMenu}>
      {finePointer && menu ? (
        <menu.Component title={props.title} url={props.url} onResult={announce} defaultOpen={openOnLoad} autoFocus={menu.focus} />
      ) : (
        <Button
          type="button"
          variant="tertiary"
          size="md"
          label="Compartir"
          icon={<Share aria-hidden width={14} height={17} />}
          iconOnlyBelow="ml"
          touchTarget
          onClick={() => {
            if (finePointer) {
              setOpenOnLoad(true);
              loadMenu();
              return;
            }
            void shareOrCopy({ title: props.title, url: props.url }, navigator).then(announce);
          }}
        />
      )}
      {/* Siempre en el DOM (vacía), así el lector de pantalla la conoce antes de que cambie. */}
      <span className={styles.status} role="status" aria-live="polite">
        {message}
      </span>
    </div>
  );
};

export default ShareButton;
