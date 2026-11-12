import { FEATURES, GOOD_FOR, label, OFFERS } from "@shared/tags.ts";

type DietLevel = "fully" | "has_options";

const levelOf = (value: string | null | undefined): DietLevel | null =>
  value === "fully" || value === "has_options" ? value : null;

type DietInput = { diet_vegetarian: string; diet_vegan: string; diet_gluten_free: string };

const DIET_CHIPS: Record<"vegetarian" | "vegan" | "gluten_free", Record<DietLevel, string>> = {
  vegetarian: { fully: "100 % vegetariano", has_options: "Opciones vegetarianas" },
  vegan: { fully: "100 % vegano", has_options: "Opciones veganas" },
  gluten_free: { fully: "100 % sin TACC", has_options: "Opciones sin TACC" },
};

/**
 * "100 % vegetariano" u "Opciones vegetarianas", "100 % vegano" u "Opciones veganas", "100 % sin TACC": sólo las que
 * aplican. Lo vegano también es vegetariano (como dietLevel en la búsqueda): con opciones veganas hay opciones
 * vegetarianas, y un vegano 100 % no repite el chip vegetariano.
 */
export function dietChips(place: DietInput): string[] {
  const vegan = levelOf(place.diet_vegan);
  const ownVegetarian = levelOf(place.diet_vegetarian);
  const vegetarian = vegan === "fully" ? null : ownVegetarian === "fully" ? "fully" : (ownVegetarian ?? vegan);
  const levels = [
    ["vegetarian", vegetarian],
    ["vegan", vegan],
    ["gluten_free", levelOf(place.diet_gluten_free)],
  ] as const;
  return levels.flatMap(([diet, level]) => (level ? [DIET_CHIPS[diet][level]] : []));
}

/**
 * Los grupos del catálogo que salen como chips, de más a menos distintivo: lo que hay en el lugar (terraza, wifi, música en
 * vivo), lo que ofrece y para qué sirve. Es una lista de grupos, no de ids: un tag nuevo de otro grupo no sale. Quedan
 * afuera las categorías (van en la línea de info), las dietas (tienen sus chips), las cocinas, comidas y bebidas, los
 * momentos del día (los dicen los horarios), el ambiente y el estilo (subjetivos: sólo sirven para la búsqueda).
 */
const OPTION_GROUPS = [FEATURES, OFFERS, GOOD_FOR];
const OPTION_TAG_ORDER: string[] = OPTION_GROUPS.flatMap((group) => Object.keys(group));

/** Los tags del lugar que se muestran, del más distintivo al menos (orden de grupos y del catálogo), en español. */
export function optionTags(tags: string[]): string[] {
  const own = new Set(tags);
  return OPTION_TAG_ORDER.filter((id) => own.has(id)).map((id) => label(id, "es"));
}

/** Máximo de chips debajo de la descripción. */
export const MAX_CHIPS = 8;

/** Los chips de la ficha: primero las dietas, después los tags más distintivos, hasta MAX_CHIPS. */
export function placeChips(place: DietInput & { tags: string[] }): string[] {
  return [...dietChips(place), ...optionTags(place.tags)].slice(0, MAX_CHIPS);
}
