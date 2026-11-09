import { describe, expect, it, vi } from "vitest";
import { createHoverStore } from "../hover";

describe("hover compartido", () => {
  it("avisa sólo cuando cambia", () => {
    const store = createHoverStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.setHovered("a");
    store.setHovered("a");
    expect(store.getHovered()).toBe("a");
    expect(listener).toHaveBeenCalledTimes(1);
    store.setHovered(null);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.setHovered("b");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("el marcador resaltado es el seleccionado y, si no hay, el del hover", () => {
    const store = createHoverStore();
    store.setHovered("a");
    expect(store.getActive()).toBe("a");
    store.setSelected("b");
    expect(store.getActive()).toBe("b");
    // El hover de la card no cambia por la selección.
    expect(store.getHovered()).toBe("a");
    store.setSelected(null);
    expect(store.getActive()).toBe("a");
  });

  it("el setter es siempre el mismo", () => {
    const store = createHoverStore();
    const { setHovered } = store;
    store.setHovered("a");
    expect(store.setHovered).toBe(setHovered);
  });
});
