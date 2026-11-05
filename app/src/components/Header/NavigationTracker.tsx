"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { recordPath } from "./utils/navigation";

/** Anota cada pathname para que "← Volver" de la ficha sepa si hay una página anterior dentro de la app. */
const NavigationTracker = () => {
  const pathname = usePathname();

  useEffect(() => {
    recordPath(pathname);
  }, [pathname]);

  return null;
};

export default NavigationTracker;
