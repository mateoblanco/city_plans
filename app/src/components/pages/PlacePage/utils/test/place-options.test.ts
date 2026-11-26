import { describe, expect, it } from "vitest";
import { ATMOSPHERE, STYLES } from "@shared/tags.ts";
import { dietChips, optionTags as optionChips, placeChips as placeChipList, type PlaceChip } from "../place-options";

// Los textos de los chips (los ids, para el ícono, se prueban aparte).
const labels = (chips: PlaceChip[]) => chips.map((chip) => chip.label);
const optionTags = (tags: string[]) => labels(optionChips(tags));
const placeChips = (place: Parameters<typeof placeChipList>[0]) => labels(placeChipList(place));

const diet = (vegetarian: string, vegan: string, glutenFree: string) => ({
  diet_vegetarian: vegetarian,
  diet_vegan: vegan,
  diet_gluten_free: glutenFree,
});
const diets = (vegetarian: string, vegan: string, glutenFree: string) => labels(dietChips(diet(vegetarian, vegan, glutenFree)));

describe("dietChips", () => {
  it("100 % u opciones, sólo con las que aplican y en orden vegetariano, vegano, sin TACC", () => {
    expect(diets("fully", "has_options", "has_options")).toEqual(["100 % vegetariano", "Opciones veganas", "Opciones sin TACC"]);
    expect(diets("has_options", "unknown", "fully")).toEqual(["Opciones vegetarianas", "100 % sin TACC"]);
    expect(diets("unknown", "none", "unknown")).toEqual([]);
  });

  it("100 % vegano no repite el chip vegetariano", () => {
    expect(diets("unknown", "fully", "unknown")).toEqual(["100 % vegano"]);
    expect(diets("fully", "fully", "fully")).toEqual(["100 % vegano", "100 % sin TACC"]);
  });

  it("con opciones veganas también hay opciones vegetarianas", () => {
    expect(diets("unknown", "has_options", "unknown")).toEqual(["Opciones vegetarianas", "Opciones veganas"]);
  });
});

describe("optionTags", () => {
  it("de más a menos distintivo: lo del lugar, ofertas y para qué sirve, en español", () => {
    expect(optionTags(["quiet", "work", "happy_hour", "wifi", "outdoor"])).toEqual(["Al aire libre", "Wifi", "Happy hour", "Para trabajar"]);
  });

  it("la azotea no sale como chip (HIDDEN_TAGS); terraza, patio y barra ya no existen", () => {
    expect(optionTags(["rooftop", "outdoor", "terrace", "patio", "bar_seating"])).toEqual(["Al aire libre"]);
  });

  it("no muestra ningún tag de ambiente ni de estilo (por grupo: tampoco uno nuevo)", () => {
    expect(optionTags([...Object.keys(ATMOSPHERE), ...Object.keys(STYLES)])).toEqual([]);
    expect(optionTags(["cozy", "neighborhood_spot", "casual", "pet_friendly"])).toEqual(["Pet friendly"]);
  });

  it("deja afuera dietas, cocinas, comidas, bebidas y momentos", () => {
    expect(optionTags(["vegan", "italian", "pizza", "wine", "dinner", "late_night", "bar"])).toEqual([]);
  });
});

describe("placeChips", () => {
  it("primero las dietas, después los tags, hasta 8", () => {
    const tags = ["quiet", "outdoor", "wifi", "live_music", "pet_friendly", "happy_hour", "work", "cozy"];
    expect(placeChips({ ...diet("unknown", "fully", "has_options"), tags })).toEqual([
      "100 % vegano",
      "Opciones sin TACC",
      "Al aire libre",
      "Música en vivo",
      "Wifi",
      "Pet friendly",
      "Happy hour",
      "Para trabajar",
    ]);
  });

  it("sin dietas ni tags útiles, ninguno", () => {
    expect(placeChips({ ...diet("unknown", "unknown", "unknown"), tags: ["bar", "dinner"] })).toEqual([]);
  });
});

describe("ids de los chips", () => {
  it("las dietas llevan su id y los tags el del catálogo", () => {
    expect(placeChipList({ ...diet("has_options", "unknown", "fully"), tags: ["wifi", "outdoor"] })).toEqual([
      { id: "vegetarian", label: "Opciones vegetarianas" },
      { id: "gluten_free", label: "100 % sin TACC" },
      { id: "outdoor", label: "Al aire libre" },
      { id: "wifi", label: "Wifi" },
    ]);
  });
});
