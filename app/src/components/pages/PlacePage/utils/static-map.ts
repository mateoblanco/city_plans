/**
 * ¿El mapa de la ficha en mobile entra en la primera pantalla? Decide el `fetchpriority="high"` de la imagen de Static
 * Maps: si entra, suele ser el LCP; si no, con prioridad alta le quitaría ancho de banda a lo que sí se ve. El servidor no
 * sabe el ancho de la pantalla, así que es una estimación para un teléfono de 390×844 (un Moto G de Lighthouse es
 * 412×823) con los altos de PlaceHeader, PlaceSummary y PlaceTags; las constantes se midieron en el navegador. En
 * noviembre de 2026, en 13 fichas publicadas, el mapa empezaba entre 566 y 720px (en 390×844): todas van con prioridad
 * alta salvo una descripción muy larga.
 */
const LAYOUT = {
  /** Lo que hay arriba del título: header, barra con el logo, padding de .columns y de la tarjeta. */
  top: 230,
  /** Título: 28/34px; deja 132px a la derecha para "Guardar" (unos 11 caracteres por línea en 390px). */
  nameLine: 34,
  nameChars: 11,
  /** Gap del título a las líneas de datos y las dos líneas (24px cada una, 2px entre ellas). */
  facts: 12 + 50,
  /** Descripción: 15/24px, unos 43 caracteres por línea en 308px; 16px antes. */
  descriptionLine: 24,
  descriptionChars: 43,
  gap: 16,
  /** Chips: 26px de alto, 8px entre filas; cada uno ~7,5px por carácter + 22 de padding y borde, 22 del ícono (16 + 6 de gap) y 8 entre chips. */
  chipRow: 34,
  chipCharWidth: 7.5,
  chipPadding: 22 + 22 + 8,
  rowWidth: 308,
  /** Gap de la tarjeta antes del mapa. */
  beforeMap: 48,
  /** Hasta dónde llega la primera pantalla, con margen: se pide alta sólo si entra con holgura. */
  fold: 760,
};

const lines = (length: number, perLine: number) => (length > 0 ? Math.ceil(length / perLine) : 0);

function chipRows(chips: string[]): number {
  let rows = 0;
  let used = Infinity;
  for (const chip of chips) {
    const width = chip.length * LAYOUT.chipCharWidth + LAYOUT.chipPadding;
    if (used + width > LAYOUT.rowWidth) {
      rows += 1;
      used = 0;
    }
    used += width;
  }
  return rows;
}

type Input = { name: string; description: string | null; chips: string[] };

/** Dónde empieza el mapa (px desde arriba) en un teléfono de 390px, estimado. */
export function estimatedMapTop(input: Input): number {
  const description = input.description?.trim() ?? "";
  const rows = chipRows(input.chips);
  return (
    LAYOUT.top +
    lines(input.name.trim().length, LAYOUT.nameChars) * LAYOUT.nameLine +
    LAYOUT.facts +
    (description ? LAYOUT.gap + lines(description.length, LAYOUT.descriptionChars) * LAYOUT.descriptionLine : 0) +
    (rows > 0 ? LAYOUT.gap + rows * LAYOUT.chipRow : 0) +
    LAYOUT.beforeMap
  );
}

/** true si el mapa probablemente se ve sin scrollear: va con fetchpriority="high". */
export function mapLikelyAboveFold(input: Input): boolean {
  return estimatedMapTop(input) < LAYOUT.fold;
}
