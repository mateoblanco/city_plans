"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { pageType } from "@/lib/product-analytics/page-type";
import { noteNavigation, track } from "@/lib/product-analytics/track";
import { recordPath } from "./utils/navigation";

/**
 * Anota cada pathname para que "← Volver" de la ficha sepa si hay una página anterior dentro de la app, y manda el
 * page_view de la analítica de producto (también en la navegación interna de Next). Va acá, en el Suspense del header
 * de cada página, y no en el layout: un Suspense con usePathname al final del layout dejaba un hueco dinámico más en
 * el HTML y empeoraba la FCP de la home en Lighthouse (1,55 → 1,96 s).
 */
const NavigationTracker = () => {
  const pathname = usePathname();

  useEffect(() => {
    recordPath(pathname);
    noteNavigation(pathname);
    // Sale como el page view de Mixpanel ($mp_web_page_view), con la ruta que agrega la librería.
    track("page_view", { page_type: pageType(pathname) });
  }, [pathname]);

  return null;
};

export default NavigationTracker;
