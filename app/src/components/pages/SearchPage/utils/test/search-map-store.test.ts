import { describe, expect, it, vi } from "vitest";
import type { SearchResult } from "@/server/search";
import { createSearchMapStore } from "../search-map-store";

const place = (id: string, lat = -34.9, branches: SearchResult["branches"] = []) =>
  ({ id, name: id, lat, lng: -56.16, iconCategory: null, branches }) as unknown as SearchResult;
const places = (n: number) => Array.from({ length: n }, (_, index) => place(`p${index}`));

describe("el mapa persistente", () => {
  it("arranca esperando la primera lista", () => {
    expect(createSearchMapStore().getState()).toMatchObject({ pending: true, places: [], fitKey: 0 });
  });

  it("una búsqueda nueva encuadra; Ver más suma puntos sin encuadrar y sin objetos nuevos", () => {
    const store = createSearchMapStore();
    const all = places(24);
    store.begin();
    store.publish({ results: all.slice(0, 12), near: null, count: 24 });
    const first = store.getState();
    expect(first).toMatchObject({ pending: false, fitKey: 1, count: 24 });
    expect(first.places).toHaveLength(12);

    store.publish({ results: all, near: null, count: 24 });
    const more = store.getState();
    expect(more.fitKey).toBe(1);
    expect(more.places).toHaveLength(24);
    // Los 12 que ya estaban son los mismos objetos: sus marcadores no reciben un position nuevo.
    more.places.slice(0, 12).forEach((point, index) => expect(point).toBe(first.places[index]));
  });

  it("publicar lo mismo no avisa", () => {
    const store = createSearchMapStore();
    const results = places(3);
    store.begin();
    store.publish({ results, near: { lat: 1, lng: 2 }, count: 3 });
    const listener = vi.fn();
    store.subscribe(listener);
    store.publish({ results: [...results], near: { lat: 1, lng: 2 }, count: 3 });
    expect(listener).not.toHaveBeenCalled();
  });

  it("entre búsquedas quedan los puntos anteriores hasta que llega la nueva, y la nueva encuadra", () => {
    const store = createSearchMapStore();
    store.begin();
    store.publish({ results: places(5), near: null, count: 5 });
    const before = store.getState().places;
    store.end();
    expect(store.getState()).toMatchObject({ pending: true, places: before, fitKey: 1 });
    store.begin();
    store.publish({ results: [place("otro")], near: null, count: 1 });
    expect(store.getState()).toMatchObject({ pending: false, fitKey: 2, count: 1 });
    expect(store.getState().places.map((point) => point.id)).toEqual(["otro"]);
  });

  it("la misma búsqueda otra vez (otro filtro con los mismos lugares) también encuadra", () => {
    const store = createSearchMapStore();
    const results = places(2);
    store.begin();
    store.publish({ results, near: null, count: 2 });
    store.end();
    store.begin();
    store.publish({ results, near: null, count: 2 });
    expect(store.getState()).toMatchObject({ pending: false, fitKey: 2 });
  });
});
