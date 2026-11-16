import type { RowLogo } from "@/server/home/assemble";

/** El nombre accesible de los dos "Ver todos" de una fila: la flecha del título y la card del final. */
export const viewAllLabel = (title: string) => `Ver todos: ${title}`;

/**
 * La card "Ver todos" del final de una fila: sólo con link (la flecha del título) y con algún lugar del pool que no
 * entró en la fila; lleva al mismo destino que la flecha. null: no se muestra.
 */
export const viewAllCard = (row: { title: string; href: string | null; more?: RowLogo[] }) =>
  row.href && row.more && row.more.length > 0 ? { href: row.href, label: viewAllLabel(row.title), logos: row.more } : null;
