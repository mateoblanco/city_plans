import { describe, expect, it } from "vitest";
import type { Params } from "@/components/pages/SearchPage/utils/search-params";
import { provisionalBar } from "../provisional-bar";

const params = (overrides: Partial<Params>): Params => ({
  query: "",
  remove: null,
  filters: null,
  loc: null,
  intent: null,
  sub: null,
  debug: false,
  profile: true,
  likes: [],
  userLocation: null,
  ...overrides,
});
const keys = (chips: { kind: string; id: string }[]) => chips.map((chip) => `${chip.kind}:${chip.id}`);

describe("barra provisoria (sólo la URL, mientras llega la búsqueda)", () => {
  it("lo activo de f: barrio, precio, dieta y abierto ahora, como chips de la barra", () => {
    const result = provisionalBar(params({ filters: "neighborhood:CORDON,price:low,diet:vegan,open:now" }));
    expect(keys(result.chips).sort()).toEqual(["diet:vegan", "neighborhood:CORDON", "openAt:now", "price:low"]);
    expect(result.chips.every((chip) => chip.fromFilter && !chip.fromText)).toBe(true);
    expect(result.location.kind).toBe("neighborhood");
  });

  it("la intención y los sub-filtros de la URL: todos los de la intención, activos los pedidos", () => {
    const result = provisionalBar(params({ intent: "bars", sub: "cocktails" }));
    expect(result.bar.intent).toEqual({ id: "bars", fromText: false });
    expect(result.bar.subs.length).toBeGreaterThan(1);
    expect(result.bar.subs.filter((sub) => sub.active).map((sub) => sub.id)).toEqual(["cocktails"]);
    expect(result.pendingSubs).toBe(false);
  });

  it("con texto y sin intención en la URL, los sub-filtros quedan pendientes (puede traerlos el texto)", () => {
    expect(provisionalBar(params({ query: "tomar algo" })).pendingSubs).toBe(true);
    expect(provisionalBar(params({ query: "tomar algo", intent: "bars" })).pendingSubs).toBe(false);
    expect(provisionalBar(params({ filters: "open:now" })).pendingSubs).toBe(false);
  });

  it("los extras de f: el tag de una fila de la home y el Ver todos de un grupo", () => {
    const result = provisionalBar(params({ filters: "tag:groups,section:outdoor" }));
    expect(keys(result.bar.extras)).toEqual(["tag:groups", "section:outdoor"]);
  });

  it("ubicación como la búsqueda: loc elegido, la cookie o pedirla", () => {
    expect(provisionalBar(params({ query: "x", loc: "all" })).location).toEqual({ kind: "all", reason: "chosen" });
    expect(provisionalBar(params({ query: "x", userLocation: "-34.905,-56.19" })).location.kind).toBe("near");
    expect(provisionalBar(params({ query: "x", userLocation: "denied" })).location).toEqual({ kind: "all", reason: "denied" });
    expect(provisionalBar(params({ query: "x" })).location).toEqual({ kind: "ask", explicit: false });
  });
});
