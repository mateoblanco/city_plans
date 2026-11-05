"use client";

import Bookmark from "@/assets/bookmark.svg";
import BookmarkFill from "@/assets/bookmark_fill.svg";
import CardToggle from "../CardToggle/CardToggle";
import { toggleSaved, useSaved } from "../../../utils/saved";

type Props = {
  placeId: string;
  name: string;
};

/**
 * Guardar ("quiero ir"): agrega o saca el lugar de la lista de pendientes (sólo en el navegador), independiente del
 * like y sin tocar el perfil de gustos. Sin localStorage no se muestra.
 */
const SaveButton = (props: Props) => {
  const saved = useSaved();
  if (!saved.available) return null;
  const isSaved = saved.ids.includes(props.placeId);

  return (
    <CardToggle
      active={isSaved}
      label={isSaved ? `Quitar ${props.name} de guardados` : `Guardar ${props.name}`}
      icon={isSaved ? <BookmarkFill aria-hidden /> : <Bookmark aria-hidden />}
      onToggle={() => toggleSaved(props.placeId)}
    />
  );
};

export default SaveButton;
