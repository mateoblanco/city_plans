/** Ejemplos que van rotando en el placeholder del buscador de la home (Search con rotatingPlaceholder), en este orden. */
export const HOME_PLACEHOLDERS = [
  "Bar para ir con amigos",
  "Café para trabajar con la compu",
  "Almuerzo con niños",
  "Sushi en Punta Carretas",
  "Chivito en Ciudad Vieja",
  "Brunch el domingo",
  "Almorzar en Ciudad Vieja",
  "Algo abierto ahora para cenar",
  "Merienda en Cordón",
  "Sin TACC en Pocitos",
  "Opciones vegetarianas para cenar",
  "Algo barato para cenar",
  "Un lugar para ver el atardecer",
  "Terraza para tomar algo",
] as const;

/** Cada cuánto cambia el ejemplo. */
export const PLACEHOLDER_INTERVAL_MS = 3500;

/** El placeholder fijo de siempre (/search, o la home cuando el usuario ya tocó el input). */
export const DEFAULT_PLACEHOLDER = "Bar para salir a tomar algo con amigos";
