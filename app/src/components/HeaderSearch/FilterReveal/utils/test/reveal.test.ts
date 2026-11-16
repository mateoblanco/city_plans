import { describe, expect, it } from "vitest";
import { nextReveal, type RevealEvent, type RevealState } from "../reveal";

const start: RevealState = { hidden: false, lastY: 0 };
const scroll = (y: number, locked = false): RevealEvent => ({ kind: "scroll", y, locked });
const run = (events: RevealEvent[], state = start) => events.reduce(nextReveal, state);

describe("filtros de la home al scrollear", () => {
  it("bajando, se guardan recién pasando 80 px", () => {
    expect(run([scroll(40), scroll(80)]).hidden).toBe(false);
    expect(run([scroll(40), scroll(81)]).hidden).toBe(true);
  });

  it("vuelven sólo cerca del tope (menos de 10 px)", () => {
    const hidden = run([scroll(300)]);
    expect(run([scroll(200), scroll(50), scroll(10)], hidden).hidden).toBe(true);
    expect(run([scroll(9)], hidden).hidden).toBe(false);
  });

  it("histéresis: ir y venir entre 10 y 80 no los cambia", () => {
    const shown = run([scroll(30), scroll(70), scroll(40), scroll(79)]);
    expect(shown.hidden).toBe(false);
    const hidden = run([scroll(100), scroll(70), scroll(20), scroll(60), scroll(11)]);
    expect(hidden.hidden).toBe(true);
  });

  it("subir pasado 80 no los guarda (sólo bajando)", () => {
    const focused = nextReveal(run([scroll(500)]), { kind: "focus" });
    expect(run([scroll(400), scroll(300)], focused).hidden).toBe(false);
  });

  it("vuelven al enfocar el buscador aunque esté abajo", () => {
    expect(nextReveal(run([scroll(500)]), { kind: "focus" }).hidden).toBe(false);
  });

  it("bloqueados (foco o desplegable abierto) nunca se guardan; al soltarse, el siguiente scroll hacia abajo los guarda", () => {
    const focused = nextReveal(run([scroll(500)]), { kind: "focus" });
    const locked = run([scroll(600, true), scroll(900, true)], focused);
    expect(locked.hidden).toBe(false);
    expect(run([scroll(890)], locked).hidden).toBe(false);
    expect(run([scroll(890), scroll(895)], locked).hidden).toBe(true);
  });

  it("bloqueados al cruzar 80: se guardan al seguir bajando ya sin bloqueo", () => {
    const state = run([scroll(50, true), scroll(120, true)]);
    expect(state.hidden).toBe(false);
    expect(run([scroll(130)], state).hidden).toBe(true);
  });
});
