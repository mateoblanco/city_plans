import { describe, expect, it, vi } from "vitest";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined) }),
}));

const { readParams } = await import("../search-params");

describe("readParams: la señal de gustos sale de la cookie de guardados", () => {
  it("usa sólo la cookie saved (la vieja cookie likes se ignora)", async () => {
    jar.clear();
    jar.set("saved", `${id(2)}.${id(1)}`);
    jar.set("likes", id(9));
    const params = await readParams(Promise.resolve({ q: "bares" }));
    expect(params.likes).toEqual([id(2), id(1)]);
  });

  it("sin cookie saved no hay guardados, aunque quede la cookie likes", async () => {
    jar.clear();
    jar.set("likes", id(9));
    expect((await readParams(Promise.resolve({}))).likes).toEqual([]);
  });
});
