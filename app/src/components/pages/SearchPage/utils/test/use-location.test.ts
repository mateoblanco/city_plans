import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshGrantedLocation } from "../use-location";

/** Navegador falso: el permiso dado, la posición que devuelve y la cookie que queda escrita. */
function browser(state: PermissionState | null, position = { latitude: -34.9011, longitude: -56.1645 }) {
  const getCurrentPosition = vi.fn((ok: PositionCallback) => ok({ coords: position } as GeolocationPosition));
  const cookies: string[] = [];
  vi.stubGlobal("navigator", {
    permissions: state === null ? undefined : { query: async () => ({ state }) },
    geolocation: { getCurrentPosition },
  });
  vi.stubGlobal("location", { protocol: "https:" });
  vi.stubGlobal("document", {
    set cookie(value: string) {
      cookies.push(value);
    },
  });
  return { getCurrentPosition, cookies };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => vi.unstubAllGlobals());

describe("refreshGrantedLocation (la home nunca pide el permiso)", () => {
  it("sin el permiso dado (prompt) o sin Permissions API no toma la ubicación ni escribe nada", async () => {
    for (const state of ["prompt", null] as const) {
      const { getCurrentPosition, cookies } = browser(state);
      const refresh = vi.fn();
      refreshGrantedLocation(null, refresh);
      await flush();
      expect(getCurrentPosition).not.toHaveBeenCalled();
      expect(cookies).toEqual([]);
      expect(refresh).not.toHaveBeenCalled();
    }
  });

  it("con el permiso dado y sin ubicación guardada, la toma sin diálogo, la guarda redondeada y vuelve a pedir la página", async () => {
    const { getCurrentPosition, cookies } = browser("granted");
    const refresh = vi.fn();
    refreshGrantedLocation(null, refresh);
    await flush();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(cookies[0]).toMatch(/^loc=-34\.901,-56\.164; path=\//);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("con la ubicación guardada cerca, sólo renueva la cookie; si se movió, vuelve a pedir la página", async () => {
    const still = browser("granted");
    const refreshStill = vi.fn();
    refreshGrantedLocation({ lat: -34.901, lng: -56.165 }, refreshStill);
    await flush();
    expect(still.cookies).toHaveLength(1);
    expect(refreshStill).not.toHaveBeenCalled();

    browser("granted", { latitude: -34.92, longitude: -56.165 });
    const refreshMoved = vi.fn();
    refreshGrantedLocation({ lat: -34.901, lng: -56.165 }, refreshMoved);
    await flush();
    expect(refreshMoved).toHaveBeenCalledTimes(1);
  });

  it("permiso retirado: guarda denied; vuelve a pedir la página sólo si había una ubicación que sacar", async () => {
    const withOrigin = browser("denied");
    const refresh = vi.fn();
    refreshGrantedLocation({ lat: -34.901, lng: -56.165 }, refresh);
    await flush();
    expect(withOrigin.cookies[0]).toMatch(/^loc=denied/);
    expect(refresh).toHaveBeenCalledTimes(1);

    const without = browser("denied");
    const refreshNone = vi.fn();
    refreshGrantedLocation(null, refreshNone);
    await flush();
    expect(without.cookies[0]).toMatch(/^loc=denied/);
    expect(without.getCurrentPosition).not.toHaveBeenCalled();
    expect(refreshNone).not.toHaveBeenCalled();
  });
});
