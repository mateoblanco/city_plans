"use client";

import { useRouter } from "next/navigation";
import Button from "@/components/base/Button/Button";
import { clearSaved, useSaved } from "../../../utils/saved";

/** Sólo en debug: borra todos los guardados (localStorage y cookie) y vuelve a correr la búsqueda sin perfil. */
const ClearSaved = () => {
  const router = useRouter();
  const saved = useSaved();

  return (
    <Button
      type="button"
      variant="tertiary"
      size="sm"
      label={`Borrar guardados (${saved.ids.length})`}
      disabled={saved.ids.length === 0}
      onClick={() => {
        clearSaved();
        router.refresh();
      }}
    />
  );
};

export default ClearSaved;
