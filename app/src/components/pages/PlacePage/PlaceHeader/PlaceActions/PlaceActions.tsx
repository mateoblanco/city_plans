"use client";

import Button from "@/components/base/Button/Button";
import Bookmark from "@/assets/bookmark.svg";
import BookmarkFill from "@/assets/bookmark_fill.svg";
import Heart from "@/assets/heart.svg";
import HeartFill from "@/assets/heart_fill.svg";
import { toggleLike, useLiked } from "@/components/pages/SearchPage/utils/likes";
import { toggleSaved, useIsSaved } from "@/components/pages/SearchPage/utils/saved";

type Props = {
  placeId: string;
  instagramHandle: string | null;
  popularHref: string | null;
};

/**
 * Me gusta y guardar de la ficha: botones de ícono con nombre fijo ("Me gusta", "Guardar"); el estado va sólo en
 * aria-pressed (y en el ícono lleno). Con el mismo guardado en el navegador que los de la card. Sin localStorage no se muestran.
 */
const PlaceActions = (props: Props) => {
  const likes = useLiked(props.placeId);
  const saved = useIsSaved(props.placeId);
  const liked = likes.active;
  const isSaved = saved.active;

  return (
    <>

      {likes.available && (
        <Button
          type="button"
          variant="secondary"
          size="md"
          label="Me gusta"
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
          label="Guardar"
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
