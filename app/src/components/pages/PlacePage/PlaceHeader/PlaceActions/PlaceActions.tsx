"use client";

import Button from "@/components/base/Button/Button";
import { toggleSaved, useIsSaved } from "@/components/pages/SearchPage/utils/saved";
import { track } from "@/components/Tracking/utils/track";
import { trackSaveToggle } from "@/components/ProductAnalytics/utils/saved";
import styles from "./PlaceActions.module.scss";

type Props = {
  placeId: string;
  slug: string;
  instagramHandle: string | null;
  popularHref: string | null;
};

/**
 * Guardar de la ficha: el corazón con texto, "Guardar" o "Guardado" (en mobile, sólo el corazón, lleno si está guardado). El estado lo da el texto visible (que es también el
 * nombre accesible), así que no lleva aria-pressed. Usa la misma lista del navegador que el corazón de la card. Sin
 * localStorage no se muestra.
 */
const PlaceActions = (props: Props) => {
  const saved = useIsSaved(props.placeId);
  if (!saved.available) return null;
  const isSaved = saved.active;

  return (
    <Button
      type="button"
      variant="tertiary"
      size="md"
      label={isSaved ? "Guardado" : "Guardar"}
      icon={<span className={styles.heart} data-saved={isSaved || undefined} aria-hidden />}
      iconOnlyBelow="ml"
      onClick={() => {
        // Con el origen de la vista de esta ficha.
        if (!toggleSaved(props.placeId)) return;
        track(props.placeId, isSaved ? "unsave" : "save");
        trackSaveToggle({ id: props.placeId, slug: props.slug }, !isSaved);
      }}
    />
  );
};

export default PlaceActions;
