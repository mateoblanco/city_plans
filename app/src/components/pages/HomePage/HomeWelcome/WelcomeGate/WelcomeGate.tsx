"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { DiscountProvider } from "@/components/DiscountChoices/utils/options";
import { browserStorage, shouldShowWelcome } from "../utils/welcome";

// El código del diálogo se baja sólo si hay que mostrarlo: no suma peso a la home.
const WelcomeDialog = dynamic(() => import("../WelcomeDialog/WelcomeDialog"), { ssr: false });

type Props = {
  providers: DiscountProvider[];
};

/**
 * Decide en el cliente, después de hidratar y de que cargó la página (evento `load` y el navegador libre, así no compite
 * con el contenido), si se muestra la bienvenida (utils/welcome.ts). Hasta entonces no renderiza nada.
 */
const WelcomeGate = (props: Props) => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let idle: number | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const decide = () => {
      if (shouldShowWelcome(browserStorage())) setShow(true);
    };
    const schedule = () => {
      if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(decide, { timeout: 2000 });
      else timeout = setTimeout(decide, 200);
    };
    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });
    return () => {
      window.removeEventListener("load", schedule);
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timeout !== undefined) clearTimeout(timeout);
    };
  }, []);

  return show ? <WelcomeDialog providers={props.providers} /> : null;
};

export default WelcomeGate;
