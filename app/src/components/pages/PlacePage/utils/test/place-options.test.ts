import { describe, expect, it } from "vitest";
import { ATMOSPHERE, STYLES } from "@shared/tags.ts";
import { dietChips, optionTags, placeChips } from "../place-options";

const diet = (vegetarian: string, vegan: string, glutenFree: string) => ({
  diet_vegetarian: vegetarian,
  diet_vegan: vegan,
  diet_gluten_free: glutenFree,
});
const diets = (vegetarian: string, vegan: string, glutenFree: string) => dietChips(diet(vegetarian, vegan, glutenFree));

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
    expect(optionTags(["quiet", "work", "happy_hour", "wifi", "terrace"])).toEqual(["Terraza", "Wifi", "Happy hour", "Para trabajar"]);
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
    const tags = ["quiet", "terrace", "wifi", "live_music", "pet_friendly", "happy_hour", "work", "cozy"];
    expect(placeChips({ ...diet("unknown", "fully", "has_options"), tags })).toEqual([
      "100 % vegano",
      "Opciones sin TACC",
      "Terraza",
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
