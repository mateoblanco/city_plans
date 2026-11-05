import { describe, expect, it } from "vitest";
import { dietSelection } from "../diet-selection";

describe("dietSelection", () => {
  it("vegetariano y vegano se excluyen: el recién marcado saca al otro", () => {
    expect(dietSelection(["vegetarian", "vegan"], "vegan")).toEqual(["vegan"]);
    expect(dietSelection(["vegan", "vegetarian"], "vegetarian")).toEqual(["vegetarian"]);
  });

  it("Sin TACC se combina con vegetariano o vegano", () => {
    expect(dietSelection(["vegetarian", "glutenFree"], "glutenFree")).toEqual(["vegetarian", "glutenFree"]);
    expect(dietSelection(["vegan", "glutenFree"], "vegan")).toEqual(["vegan", "glutenFree"]);
    expect(dietSelection(["glutenFree", "vegetarian"], "vegetarian")).toEqual(["glutenFree", "vegetarian"]);
  });

  it("desmarcar no cambia lo demás; con los dos del texto queda vegano", () => {
    expect(dietSelection(["glutenFree"], undefined)).toEqual(["glutenFree"]);
    expect(dietSelection([], undefined)).toEqual([]);
    expect(dietSelection(["vegan", "vegetarian", "glutenFree"], "glutenFree")).toEqual(["vegan", "glutenFree"]);
  });
});
