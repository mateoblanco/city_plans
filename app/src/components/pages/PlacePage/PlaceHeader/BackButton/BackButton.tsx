"use client";

import { Button } from "@base-ui/react/button";
import { useRouter } from "next/navigation";
import ArrowLeft from "@/assets/arrow_left.svg";
import { hasInAppHistory } from "@/components/Header/utils/navigation";
import styles from "./BackButton.module.scss";

type Props = {
  /** Texto claro u oscuro según la barra de color; sin barra, el de siempre. */
  tone: "light" | "dark" | null;
};

/** "← Volver": la página anterior si se llegó desde la app; si no (URL abierta directo), la home. */
const BackButton = (props: Props) => {
  const router = useRouter();

  return (
    <Button
      type="button"
      className={styles.back}
      data-tone={props.tone ?? undefined}
      onClick={() => (hasInAppHistory() ? router.back() : router.push("/"))}
    >
      <ArrowLeft aria-hidden width={16} height={13} />
      Volver
    </Button>
  );
};

export default BackButton;
