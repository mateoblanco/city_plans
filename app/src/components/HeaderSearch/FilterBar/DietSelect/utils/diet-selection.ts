/** Orden de las opciones del select de dieta. */
export const DIET_OPTIONS = ["vegetarian", "vegan", "glutenFree"] as const;

/** Vegetariano y vegano se excluyen: el recién marcado saca al otro. Sin TACC se combina con cualquiera. */
const EXCLUSIVE: Record<string, string> = { vegetarian: "vegan", vegan: "vegetarian" };

/**
 * La elección del select después de un clic (added: lo recién marcado). Si quedaron los dos (p. ej. "vegano y
 * vegetariano" en el texto) y el clic no fue en ninguno, queda vegano, que ya es vegetariano.
 */
export function dietSelection(values: string[], added: string | undefined): string[] {
  const other = added ? EXCLUSIVE[added] : undefined;
  if (other) return values.filter((id) => id !== other);
  return values.includes("vegan") ? values.filter((id) => id !== "vegetarian") : values;
}
