/** Meta description (Google): hasta 155 caracteres. */
export const META_DESCRIPTION_MAX = 155;
/** og:description y twitter:description: más corta, para que la tarjeta de WhatsApp, X o Slack no la corte a mitad. */
export const SHARE_DESCRIPTION_MAX = 125;

/**
 * Junta los espacios y, si pasa de `max`, corta en la última palabra que entra (sin la puntuación del final) y agrega "…":
 * el resultado nunca pasa de `max`. Sin una palabra que entre, corta el texto. undefined si queda vacío.
 */
export function truncateAtWord(text: string | null | undefined, max: number): string | undefined {
  const clean = text?.replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s.,;:·-]+$/u, "")}…`;
}

/** La descripción para compartir (og/twitter) a partir de la de la página. */
export function shareDescription(description: string): string;
export function shareDescription(description: string | null | undefined): string | undefined;
export function shareDescription(description: string | null | undefined) {
  return truncateAtWord(description, SHARE_DESCRIPTION_MAX);
}
