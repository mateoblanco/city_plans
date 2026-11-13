import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const searchWelcomePlaces = vi.fn();
const welcomePlaces = vi.fn();
vi.mock("@/server/welcome", () => ({ searchWelcomePlaces, welcomePlaces }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));

const { GET: search } = await import("../search/route");
const { GET: places } = await import("../places/route");

const request = (query: string) => new NextRequest(`http://localhost/api/welcome/search${query}`);

afterEach(() => vi.clearAllMocks());

describe("/api/welcome/search", () => {
  it("sin q, vacío o demasiado largo: 400 sin consultar", async () => {
    for (const query of ["", "?q=", "?q=%20%20", `?q=${"a".repeat(101)}`]) {
      const response = await search(request(query));
      expect(response.status).toBe(400);
    }
    expect(searchWelcomePlaces).not.toHaveBeenCalled();
  });

  it("devuelve los lugares", async () => {
    searchWelcomePlaces.mockResolvedValue([{ id: "a" }]);
    const response = await search(request("?q=Café"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ places: [{ id: "a" }] });
    expect(searchWelcomePlaces).toHaveBeenCalledWith("Café");
  });

  it("si falla la base: 500 con el error en español", async () => {
    searchWelcomePlaces.mockRejectedValue(new Error("timeout"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await search(request("?q=bar"));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/No pudimos/);
  });
});

describe("/api/welcome/places", () => {
  it("devuelve la grilla; si falla, 500", async () => {
    welcomePlaces.mockResolvedValueOnce([{ id: "a" }]);
    expect(await (await places()).json()).toEqual({ places: [{ id: "a" }] });
    welcomePlaces.mockRejectedValueOnce(new Error("timeout"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await places()).status).toBe(500);
  });
});
