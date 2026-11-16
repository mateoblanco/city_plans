/**
 * Corre `run` una vez cuando la página está visible: ya, o al volver a la pestaña si se abrió en segundo plano. Devuelve
 * la limpieza (para el efecto).
 */
export function whenVisible(doc: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">, run: () => void): () => void {
  if (doc.visibilityState === "visible") {
    run();
    return () => {};
  }
  const onChange = () => {
    if (doc.visibilityState !== "visible") return;
    doc.removeEventListener("visibilitychange", onChange);
    run();
  };
  doc.addEventListener("visibilitychange", onChange);
  return () => doc.removeEventListener("visibilitychange", onChange);
}
