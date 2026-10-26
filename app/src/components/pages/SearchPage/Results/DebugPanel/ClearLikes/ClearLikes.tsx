"use client";

import { useRouter } from "next/navigation";
import Button from "@/components/base/Button/Button";
import { clearLikes, useLikes } from "../../../utils/likes";

/** Sólo en debug: borra todos los likes (localStorage y cookie) y vuelve a correr la búsqueda sin perfil. */
const ClearLikes = () => {
  const router = useRouter();
  const likes = useLikes();

  return (
    <Button
      type="button"
      label={`Borrar likes (${likes.ids.length})`}
      disabled={likes.ids.length === 0}
      onClick={() => {
        clearLikes();
        router.refresh();
      }}
    />
  );
};

export default ClearLikes;
