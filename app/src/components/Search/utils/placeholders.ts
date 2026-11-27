import { INTENT_IDS, type IntentId } from "@shared/intents.ts";

/**
 * Ejemplos que van rotando en el placeholder del buscador (Search con rotatingPlaceholder), en este orden, sin categoría
 * elegida: la home, la ficha, las guías y "Todo" en /search. Un mix de todas.
 */
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

/** Los ejemplos con una pestaña de intención elegida (/search?intent=…): sólo de esa categoría. */
export const INTENT_PLACEHOLDERS: Record<IntentId, readonly string[]> = {
  eat: [
    "Almuerzo con niños",
    "Sushi en Punta Carretas",
    "Chivito en Ciudad Vieja",
    "Almorzar en Ciudad Vieja",
    "Algo abierto ahora para cenar",
    "Opciones vegetarianas para cenar",
    "Algo barato para cenar",
    "Sin TACC en Pocitos",
    "Parrilla para ir en grupo",
    "Pasta casera en Cordón",
  ],
  cafes: [
    "Café para trabajar con la compu",
    "Brunch el domingo",
    "Merienda en Cordón",
    "Café de especialidad en Pocitos",
    "Un café tranquilo para leer",
    "Desayuno temprano",
    "Café con terraza",
    "Café con opciones sin TACC",
  ],
  bars: [
    "Bar para ir con amigos",
    "Terraza para tomar algo",
    "Un lugar para ver el atardecer",
    "Cervecería en Palermo",
    "Vinos en Ciudad Vieja",
    "Happy hour después del trabajo",
    "Bar tranquilo para una cita",
    "Tragos de autor",
  ],
  desserts: [
    "Helado en Pocitos",
    "Torta para la merienda",
    "Postre después de cenar",
    "Panadería en Cordón",
    "Algo dulce abierto ahora",
    "Postres sin TACC",
    "Alfajores caseros",
    "Churros en la rambla",
  ],
};

/** Los ejemplos de la intención (la de la URL); sin intención, o una que no existe, el mix. */
export function placeholdersFor(intent: string | null | undefined): readonly string[] {
  const id = INTENT_IDS.find((candidate) => candidate === intent);
  return id ? INTENT_PLACEHOLDERS[id] : HOME_PLACEHOLDERS;
}

/** Cada cuánto cambia el ejemplo. */
export const PLACEHOLDER_INTERVAL_MS = 3500;

/** El placeholder fijo, sin rotatingPlaceholder. */
export const DEFAULT_PLACEHOLDER = "Bar para salir a tomar algo con amigos";
