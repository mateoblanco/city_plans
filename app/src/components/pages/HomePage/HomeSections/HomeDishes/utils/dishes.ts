import { searchHref } from "@/components/pages/SearchPage/utils/search-href";

export type Dish = { text: string; href: string };

/** Los platos de la home, en este orden. Por ahora sólo texto (sin íconos). */
const DISH_NAMES = ["Hamburguesas", "Sushi", "Pastas", "Chivito", "Parrilla", "Pizza", "Milanesas", "Empanadas"];

/** Cada plato lleva a /search con su nombre como texto: lo mismo que escribirlo en el buscador. */
export const DISHES: Dish[] = DISH_NAMES.map((text) => ({ text, href: searchHref({ q: text }) }));
