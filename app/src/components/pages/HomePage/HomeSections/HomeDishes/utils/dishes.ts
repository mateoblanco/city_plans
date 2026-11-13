import type { StaticImageData } from "next/image";
import { searchHref } from "@/components/pages/SearchPage/utils/search-href";
import burger from "@/assets/food/burger.webp";
import sushi from "@/assets/food/sushi.webp";
import pasta from "@/assets/food/pasta.webp";
import chivito from "@/assets/food/chivito.webp";
import asado from "@/assets/food/asado.webp";
import pizza from "@/assets/food/pizza.webp";
import milanesa from "@/assets/food/milanesa.webp";

export type Dish = { text: string; href: string; image: StaticImageData };

/** Los platos de la home, en este orden, cada uno con su foto (`assets/food`, cuadradas). */
const DISH_IMAGES: [text: string, image: StaticImageData][] = [
  ["Hamburguesas", burger],
  ["Sushi", sushi],
  ["Pastas", pasta],
  ["Chivito", chivito],
  ["Parrilla", asado],
  ["Pizza", pizza],
  ["Milanesas", milanesa],
];

/** Cada plato lleva a /search con su nombre como texto: lo mismo que escribirlo en el buscador. */
export const DISHES: Dish[] = DISH_IMAGES.map(([text, image]) => ({ text, href: searchHref({ q: text }), image }));

/** Con la fila a la vista al cargar (va primera en la home): las que entran en mobile (390 px) van eager; las primeras (HIGH_PRIORITY_CARDS), además con fetchPriority high: la primera foto es el LCP. */
export const EAGER_DISHES = 4;
