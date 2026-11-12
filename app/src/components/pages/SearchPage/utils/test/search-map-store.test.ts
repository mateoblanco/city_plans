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

  it("el contador de Cerca de: igual no avisa, distinto sí", () => {
    const store = createSearchMapStore();
    const results = places(3);
    store.begin();
    store.publish({ results, near: null, count: 3, nearby: { label: "Palermo", count: 6, only: false } });
    const listener = vi.fn();
    store.subscribe(listener);
    store.publish({ results, near: null, count: 3, nearby: { label: "Palermo", count: 6, only: false } });
    expect(listener).not.toHaveBeenCalled();
    store.publish({ results, near: null, count: 3, nearby: { label: "Palermo", count: 7, only: false } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().nearby).toEqual({ label: "Palermo", count: 7, only: false });
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

describe("zona del mapa y Buscar en esta zona", () => {
  const zone = { south: -34.92, west: -56.16, north: -34.9, east: -56.14 };

  it("publica la zona de la búsqueda y la base para armar el link", () => {
    const store = createSearchMapStore();
    const base = { state: { q: "bares", loc: "near" }, chips: [] };
    store.begin();
    store.publish({ results: places(2), near: null, count: 2, zone, base });
    expect(store.getState()).toMatchObject({ zone, base, fitKey: 1 });
    // Una base igual (otro objeto) no cambia el estado.
    const before = store.getState();
    store.publish({ results: before.results, near: null, count: 2, zone: { ...zone }, base: { state: { q: "bares", loc: "near" }, chips: [] } });
    expect(store.getState()).toBe(before);
  });

  it("mover el mapa deja el área visible; una búsqueda nueva la saca (el botón se va)", () => {
    const store = createSearchMapStore();
    store.begin();
    store.publish({ results: places(2), near: null, count: 2 });
    store.setViewport(zone);
    expect(store.getState().viewport).toEqual(zone);
    // "Ver más" (misma búsqueda) no la saca.
    store.publish({ results: places(3), near: null, count: 3 });
    expect(store.getState().viewport).toEqual(zone);
    store.end();
    store.begin();
    store.publish({ results: places(1), near: null, count: 1, zone });
    expect(store.getState().viewport).toBeNull();
  });

  it("esperando la ubicación: locating hasta que llega una lista", () => {
    const store = createSearchMapStore();
    store.setLocating(true);
    expect(store.getState().locating).toBe(true);
    store.begin();
    store.publish({ results: places(1), near: { lat: -34.9, lng: -56.16 }, count: 1 });
    expect(store.getState().locating).toBe(false);
  });
});

