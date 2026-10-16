"use client";

import { useState } from "react";
import styles from "./CopyResponse.module.scss";

type Props = {
  /** La respuesta llega como texto: un objeto grande como prop de un client component pesa más en el payload. */
  json: string;
};

/** Sólo con ?debug=1: copia un JSON con la URL y la respuesta entera (resultados, puntajes y debug). */
const CopyResponse = (props: Props) => {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  const copy = async () => {
    const text = JSON.stringify({ url: window.location.href, copiedAt: new Date().toISOString(), response: JSON.parse(props.json) }, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
    setTimeout(() => setStatus("idle"), 2000);
  };

  return (
    <button type="button" className={styles.copyResponse} onClick={copy}>
      {status === "copied" ? "Copiado ✓" : status === "failed" ? "No se pudo copiar" : "Copiar respuesta"}
    </button>
  );
};

export default CopyResponse;
