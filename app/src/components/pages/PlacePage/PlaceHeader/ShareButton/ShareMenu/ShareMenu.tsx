"use client";

import { useEffect, useRef } from "react";
import { Menu } from "@base-ui/react/menu";
import { buttonClassName } from "@/components/base/Button/Button";
import { copyLink, whatsappShareHref, type ShareResult } from "../../../utils/share";
import styles from "./ShareMenu.module.scss";

type Props = {
  title: string;
  url: string;
  /** Recibe el resultado de "Copiar link" (el aviso lo muestra ShareButton). */
  onResult: (result: ShareResult) => void;
  /** Abierto al montarse (hubo click antes de que llegara este chunk). */
  defaultOpen: boolean;
  /** Toma el foco al montarse (reemplaza al botón provisorio, que lo tenía). */
  autoFocus: boolean;
};

/**
 * El "Compartir" de desktop (mouse o trackpad): el botón abre un menú debajo, alineado a su derecha, con "Copiar link" y
 * "WhatsApp" (wa.me en otra pestaña). Teclado, Escape y click afuera son de Base UI. Va en su propio chunk: ShareButton lo
 * importa sólo con mouse y con la intención (encima o con foco), así la ficha no baja el Menu al cargar.
 */
const ShareMenu = (props: Props) => {
  const trigger = useRef<HTMLButtonElement>(null);

  // Sólo al montarse: después el foco es de Base UI.
  const autoFocus = useRef(props.autoFocus);
  useEffect(() => {
    if (autoFocus.current) trigger.current?.focus();
  }, []);

  return (
    <Menu.Root modal={false} defaultOpen={props.defaultOpen}>
      <Menu.Trigger ref={trigger} className={buttonClassName({ variant: "secondary", size: "md", touchTarget: true })}>
        Compartir
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className={styles.positioner} sideOffset={6} align="end">
          <Menu.Popup className={styles.popup}>
            <Menu.Item className={styles.item} onClick={() => void copyLink(props.url, navigator).then(props.onResult)}>
              Copiar link
            </Menu.Item>
            <Menu.LinkItem
              className={styles.item}
              href={whatsappShareHref(props.title, props.url)}
              target="_blank"
              rel="noopener noreferrer"
              closeOnClick
            >
              WhatsApp
            </Menu.LinkItem>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
};

export default ShareMenu;
