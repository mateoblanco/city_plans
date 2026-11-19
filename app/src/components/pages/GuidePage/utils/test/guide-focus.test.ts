import { describe, expect, it, vi } from "vitest";
import { createGuideFocusStore } from "../guide-focus";

describe("resaltado de la guía", () => {
  it("el hover o foco gana sobre el que está a la vista; al salir, vuelve el de la vista", () => {
    const store = createGuideFocusStore();
    expect(store.getActive()).toBeNull();
    store.setInView("a");
    expect(store.getActive()).toBe("a");
    store.setHovered("b");
    expect(store.getActive()).toBe("b");
    store.setInView("c");
    expect(store.getActive()).toBe("b");
    store.setHovered(null);
    expect(store.getActive()).toBe("c");
  });

  it("avisa sólo cuando algo cambia", () => {
    const store = createGuideFocusStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.setInView("a");
    store.setInView("a");
    store.setHovered(null);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.setInView("b");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
