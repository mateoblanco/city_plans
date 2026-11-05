"use client";

import Button from "@/components/base/Button/Button";
import Bookmark from "@/assets/bookmark.svg";
import BookmarkFill from "@/assets/bookmark_fill.svg";
import Heart from "@/assets/heart.svg";
import HeartFill from "@/assets/heart_fill.svg";
import { toggleLike, useLikes } from "@/components/pages/SearchPage/utils/likes";
import { toggleSaved, useSaved } from "@/components/pages/SearchPage/utils/saved";

type Props = {
  placeId: string;
  instagramHandle: string | null;
  popularHref: string | null;
};

/**
 * Me gusta y guardar de la ficha: botones con texto (acción → estado: "Me gusta" → "Te gusta", "Guardar" → "Guardado"),
 * con el mismo guardado en el navegador que los de la card. Sin localStorage no se muestran.
 */
const PlaceActions = (props: Props) => {
  const likes = useLikes();
  const saved = useSaved();
  const liked = likes.ids.includes(props.placeId);
  const isSaved = saved.ids.includes(props.placeId);

  return (
    <>

      {likes.available && (
        <Button
          type="button"
          variant="secondary"
          size="md"
          label={liked ? "Te gusta" : "Me gusta"}
          pressed={liked}
          onlyIcon
          icon={liked ? <HeartFill aria-hidden /> : <Heart aria-hidden />}
          onClick={() => toggleLike(props.placeId)}
        />
      )}
      {saved.available && (
        <Button
          type="button"
          variant="secondary"
          size="md"
          label={isSaved ? "Guardado" : "Guardar"}
          onlyIcon
          pressed={isSaved}
          icon={isSaved ? <BookmarkFill aria-hidden /> : <Bookmark aria-hidden />}
          onClick={() => toggleSaved(props.placeId)}
        />
      )}
    </>
  );
};

export default PlaceActions;
