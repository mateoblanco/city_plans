import { describe, expect, it, vi } from "vitest";
import { loadPlaceGoogle, placeGoogleUrl, readPlaceGoogle } from "../load";

const PLACE = "3f2b8c1e-2a4d-4c6b-9e8f-1a2b3c4d5e6f";
const INFO = {
  openNow: false,
  rating: 4.4,
  ratingCount: 1230,
  reviewsHref: "https://www.google.com/maps/place/reviews",
  address: "Sarmiento 1345",
  week: [1, 2, 3, 4, 5, 6, 0].map((day) => ({ day, ranges: ["12:00 – 15:00"], allDay: false })),
  website: "https://ejemplo.uy/",
  whatsappHref: null,
};

/** Un document de mentira: visible o en segundo plano, con visibilitychange. */
function fakeDoc(visibilityState: DocumentVisibilityState) {
  const listeners = new Set<() => void>();
  return {
    visibilityState,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    show() {
      this.visibilityState = "visible";
      for (const fn of [...listeners]) fn();
    },
    listeners,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("loadPlaceGoogle", () => {
  it("visible: una sola llamada a la ruta, sin caché, y el resultado", async () => {
    const fetchFn = vi.fn(async () => ok(INFO));
    const onResult = vi.fn();
    loadPlaceGoogle(PLACE, { current: false }, onResult, { fetchFn, doc: fakeDoc("visible") as unknown as Document });
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(placeGoogleUrl(PLACE), { cache: "no-store", credentials: "same-origin" });
    expect(placeGoogleUrl(PLACE)).toBe(`/api/place-google/${PLACE}`);
    expect(onResult).toHaveBeenCalledWith(INFO);
  });

  it("el efecto que corre dos veces (StrictMode) con la misma guarda no vuelve a llamar", async () => {
    const fetchFn = vi.fn(async () => ok(INFO));
    const started = { current: false };
    const doc = fakeDoc("visible") as unknown as Document;
    const cleanup = loadPlaceGoogle(PLACE, started, () => {}, { fetchFn, doc });
    cleanup();
    loadPlaceGoogle(PLACE, started, () => {}, { fetchFn, doc });
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("en segundo plano (pestaña abierta atrás, prerender): nada hasta que se muestra; la limpieza deja de esperar", async () => {
    const fetchFn = vi.fn(async () => ok(INFO));
    const doc = fakeDoc("hidden");
    loadPlaceGoogle(PLACE, { current: false }, () => {}, { fetchFn, doc: doc as unknown as Document });
    expect(fetchFn).not.toHaveBeenCalled();
    doc.show();
    doc.show();
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const other = fakeDoc("hidden");
    const fetchOther = vi.fn(async () => ok(INFO));
    loadPlaceGoogle(PLACE, { current: false }, () => {}, { fetchFn: fetchOther, doc: other as unknown as Document })();
    other.show();
    expect(fetchOther).not.toHaveBeenCalled();
  });

  it("sin reintentos: un error de red, un 204 (bot, límite, Google falló) o un 500 terminan en null con una sola llamada", async () => {
    for (const response of [() => Promise.reject(new Error("offline")), async () => new Response(null, { status: 204 }), async () => new Response("x", { status: 500 })]) {
      const fetchFn = vi.fn(response);
      const onResult = vi.fn();
      loadPlaceGoogle(PLACE, { current: false }, onResult, { fetchFn, doc: fakeDoc("visible") as unknown as Document });
      await flush();
      await flush();
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(onResult).toHaveBeenCalledWith(null);
    }
  });
});

describe("readPlaceGoogle", () => {
  it("se queda con lo válido y deja en null lo que no tiene la forma esperada", () => {
    expect(readPlaceGoogle(INFO)).toEqual(INFO);
    expect(readPlaceGoogle({ rating: "4", week: [{ day: 1 }], openNow: "sí", address: "" })).toEqual({
      openNow: null,
      rating: null,
      ratingCount: null,
      reviewsHref: null,
      address: null,
      week: null,
      website: null,
      whatsappHref: null,
    });
    expect(readPlaceGoogle(null)).toBeNull();
    expect(readPlaceGoogle("x")).toBeNull();
  });
});
