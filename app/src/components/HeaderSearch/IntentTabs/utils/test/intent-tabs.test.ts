import { describe, expect, it } from "vitest";
import { emptyBar } from "@/server/search/intents";
import type { BarRef } from "@/components/pages/SearchPage/utils/search-href";
import { intentTabs, TAB_ICONS, urlBar } from "../intent-tabs";

const params = (href: string) => new URL(href, "https://x.test").searchParams;
const labels = (tabs: ReturnType<typeof intentTabs>) => tabs.map((tab) => tab.label);
const currentOf = (tabs: ReturnType<typeof intentTabs>) => tabs.filter((tab) => tab.current).map((tab) => tab.label);

describe("pestañas de intención", () => {
  it("Todo, Comer, Tomar algo, Cafés y Postres, en ese orden; con ícono todas menos Todo", () => {
    const tabs = intentTabs({ q: "" }, emptyBar(), true);
    expect(labels(tabs)).toEqual(["Todo", "Comer", "Tomar algo", "Cafés", "Postres"]);
    expect(tabs.map((tab) => tab.icon !== null)).toEqual([false, true, true, true, true]);
    expect(TAB_ICONS.eat).not.toBe(undefined);
  });

  it("home: Todo es la actual y lleva a /; cada intención va a /search con esa intención", () => {
    const tabs = intentTabs({ q: "" }, emptyBar(), true);
    expect(currentOf(tabs)).toEqual(["Todo"]);
    expect(tabs[0].href).toBe("/");
    expect(tabs.slice(1).map((tab) => tab.href)).toEqual(["/search?intent=eat", "/search?intent=bars", "/search?intent=cafes", "/search?intent=desserts"]);
  });

  it("/search: cambiar de intención conserva texto, filtros y ubicación; Todo saca la intención", () => {
    const state = { q: "con amigos", f: "neighborhood:CORDON,open:today", loc: "near", intent: "bars", sub: "cocktails" };
    const bar: BarRef = { intent: { id: "bars", fromText: false }, textIntent: null, subs: [], extras: [] };
    const tabs = intentTabs(state, bar);
    expect(currentOf(tabs)).toEqual(["Tomar algo"]);
    const cafes = params(tabs.find((tab) => tab.id === "cafes")!.href);
    expect([cafes.get("q"), cafes.get("f"), cafes.get("loc"), cafes.get("intent"), cafes.get("sub")]).toEqual(["con amigos", "neighborhood:CORDON,open:today", "near", "cafes", null]);
    const all = params(tabs[0].href);
    expect([all.get("q"), all.get("f"), all.get("loc"), all.get("intent"), all.get("sub")]).toEqual(["con amigos", "neighborhood:CORDON,open:today", "near", null, null]);
    // La actual vuelve a la misma búsqueda.
    expect(params(tabs.find((tab) => tab.current)!.href).get("intent")).toBe("bars");
  });

  it("la intención que detectó el texto queda activa; Todo la quita (remove), y el texto se mantiene", () => {
    const state = { q: "tomar algo en palermo" };
    const bar: BarRef = { intent: { id: "bars", fromText: true }, textIntent: "bars", subs: [], extras: [] };
    const tabs = intentTabs(state, bar);
    expect(currentOf(tabs)).toEqual(["Tomar algo"]);
    const all = params(tabs[0].href);
    expect(all.get("q")).toBe("tomar algo en palermo");
    expect(all.get("remove")).toContain("intent:bars");
    const eat = params(tabs.find((tab) => tab.id === "eat")!.href);
    expect([eat.get("q"), eat.get("intent")]).toEqual(["tomar algo en palermo", "eat"]);
  });

  it("sin la búsqueda: la intención de la URL (una que no existe cuenta como ninguna); sin parámetros, ninguna activa", () => {
    expect(currentOf(intentTabs({ q: "x", intent: "cafes" }, urlBar("cafes")))).toEqual(["Cafés"]);
    expect(currentOf(intentTabs({ q: "x" }, urlBar("pizzerias")))).toEqual(["Todo"]);
    expect(currentOf(intentTabs({ q: "" }, null))).toEqual([]);
  });
});
