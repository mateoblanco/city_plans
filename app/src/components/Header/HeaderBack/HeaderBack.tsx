"use client";

import { useRouter } from "next/navigation";
import ArrowLeft from "@/assets/arrow_left.svg";
import Button from "@/components/base/Button/Button";
import { goBack } from "@/components/Header/utils/navigation";
import styles from "./HeaderBack.module.scss";

/**
 * Mobile: la flecha de volver del header (antes del input en /search, sola en la ficha). Vuelve como "← Volver" de la
 * ficha (goBack); desde md no se muestra.
 */
type Props = {
  /** Desde qué breakpoint no se muestra (el mismo que el compactBelow del Header): md, o ml en la ficha. */
  below?: "md" | "ml";
};

const HeaderBack = (props: Props) => {
  const router = useRouter();

  return (
    <div className={styles.back} data-below={props.below ?? "md"}>
      <Button
        type="button"
        variant="ghost"
        size="md"
        onlyIcon
        label="Volver"
        icon={<ArrowLeft aria-hidden />}
        onClick={() => goBack(router)}
      />
    </div>
  );
};

export default HeaderBack;
