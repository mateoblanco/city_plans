"use client";

import Button from "@/components/base/Button/Button";
import Heart from "@/assets/heart.svg";
import HeartFill from "@/assets/heart_fill.svg";
import { toggleSaved, useIsSaved } from "@/components/pages/SearchPage/utils/saved";

type Props = {
  placeId: string;
  instagramHandle: string | null;
  popularHref: string | null;
};

/**
 * Guardar de la ficha: el corazón con texto, "Guardar" o "Guardado". El estado lo da el texto visible (que es también el
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
      variant="secondary"
      size="md"
      label={isSaved ? "Guardado" : "Guardar"}
      icon={isSaved ? <HeartFill aria-hidden /> : <Heart aria-hidden />}
      onClick={() => toggleSaved(props.placeId)}
    />
  );
};

export default PlaceActions;
