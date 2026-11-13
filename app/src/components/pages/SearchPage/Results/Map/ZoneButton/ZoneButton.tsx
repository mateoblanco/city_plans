"use client";

import { useRouter } from "next/navigation";
import { use, useSyncExternalStore, useTransition } from "react";
import Button from "@/components/base/Button/Button";
import { normalizeBounds } from "@/lib/location";
import { zoneHref } from "../../../utils/search-href";
import { INITIAL_SEARCH_MAP_STATE } from "../../../utils/search-map-store";
import { SearchMapContext } from "../../../utils/use-search-map";
import styles from "./ZoneButton.module.scss";

/**
 * "Buscar en esta zona": aparece cuando la persona movió el mapa (arrastre o zoom) y busca lo mismo (texto, intención,
 * filtros) dentro del área visible, que reemplaza al barrio o a cerca mío ("Zona del mapa"). Mover el mapa no busca.
 * Va arriba y centrado sobre el mapa (MapColumn), en desktop y en mobile.
 */
const ZoneButton = () => {
  const store = use(SearchMapContext);
  const { viewport, base } = useSyncExternalStore(store.subscribe, store.getState, () => INITIAL_SEARCH_MAP_STATE);
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const bounds = viewport ? normalizeBounds(viewport) : null;
  if (!bounds || !base) return null;

  return (
    <div className={styles.zone}>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        label={navigating ? "Buscando…" : "Buscar en esta zona"}
        disabled={navigating}
        onClick={() => {
          const href = zoneHref(base.state, bounds, base.chips);
          startNavigation(() => {
            router.push(href);
            store.setViewport(null);
          });
        }}
      />
    </div>
  );
};

export default ZoneButton;
