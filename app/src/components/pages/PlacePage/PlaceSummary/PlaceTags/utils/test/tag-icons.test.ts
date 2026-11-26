import { describe, expect, it } from "vitest";
import { CHIP_IDS } from "../../../../utils/place-options";
import { TAG_ICONS } from "../tag-icons";

// En los tests (sin svgr) un .svg importado es una URL: alcanza con que esté.
describe("TAG_ICONS", () => {
  it("cada chip que puede salir en la ficha tiene su ícono", () => {
    expect(CHIP_IDS.filter((id) => !TAG_ICONS[id])).toEqual([]);
  });

  it("no hay íconos de más (ni de tags ocultos o retirados)", () => {
    expect(Object.keys(TAG_ICONS).filter((id) => !CHIP_IDS.includes(id))).toEqual([]);
    for (const id of ["rooftop", "terrace", "patio", "bar_seating"]) expect(TAG_ICONS[id], id).toBeUndefined();
  });
});
