"use client";

import { useEffect } from "react";
import { loadMixpanel } from "@/lib/product-analytics/load";
import { attach, clickTarget, disableProductAnalytics, enableProductAnalytics, isAutomated, track } from "@/lib/product-analytics/track";

type Props = {
  mode: "send" | "debug";
  token: string;
};

/**
 * Analítica de producto (Mixpanel), en el layout sólo con modo `send` (Production) o `debug`. Prende `track` al
 * hidratar (los eventos esperan en memoria), y la librería se baja después del `load` y con el navegador libre: no suma
 * peso al arranque. Bots y navegadores automatizados no miden. Escucha los clicks de los elementos con `data-pa`
 * (`trackAttrs`, para server components). El page_view lo manda Header/NavigationTracker. Sin usePathname ni Suspense:
 * no agrega un hueco dinámico al HTML.
 */
const ProductAnalytics = (props: Props) => {
  useEffect(() => {
    if (isAutomated(navigator)) {
      disableProductAnalytics();
      return;
    }
    enableProductAnalytics(props.mode);
    let idle: number | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const load = () => {
      void loadMixpanel(props.mode, props.token).then((client) => {
        if (client && !cancelled) attach(client);
      });
    };
    const schedule = () => {
      if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(load, { timeout: 4000 });
      else timeout = setTimeout(load, 1000);
    };
    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });

    // Click y click del medio (abrir en otra pestaña), en captura: corre antes de que el link navegue.
    const onClick = (event: MouseEvent) => {
      if (event.type === "auxclick" && event.button !== 1) return;
      const hit = clickTarget(event.target);
      if (hit) track(hit.event, hit.props as never);
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onClick, true);
    return () => {
      cancelled = true;
      window.removeEventListener("load", schedule);
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timeout !== undefined) clearTimeout(timeout);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("auxclick", onClick, true);
    };
  }, [props.mode, props.token]);

  return null;
};

export default ProductAnalytics;
