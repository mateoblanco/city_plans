import { describe, expect, it } from "vitest";
import { nextExpanded, type ExpandEvent } from "../expand";

const run = (events: ExpandEvent[], open = false) => events.reduce(nextExpanded, open);

describe("buscador plegado del header", () => {
  it("se abre al enfocar o tocar el input", () => {
    expect(run([{ kind: "input" }])).toBe(true);
    expect(run([{ kind: "input" }], true)).toBe(true);
  });

  it("se cierra al tocar afuera o al irse el foco", () => {
    expect(run([{ kind: "input" }, { kind: "outside", locked: false }])).toBe(false);
  });

  it("con un desplegable abierto, tocar afuera (su popup) no lo cierra", () => {
    expect(run([{ kind: "input" }, { kind: "outside", locked: true }])).toBe(true);
    // Cerrado sigue cerrado.
    expect(run([{ kind: "outside", locked: true }])).toBe(false);
  });

  it("Escape lo cierra y volver al input lo abre", () => {
    expect(run([{ kind: "input" }, { kind: "escape" }])).toBe(false);
    expect(run([{ kind: "input" }, { kind: "escape" }, { kind: "input" }])).toBe(true);
  });
});
