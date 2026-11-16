import { describe, expect, it, vi } from "vitest";
import { createClearer, escapeAction } from "../clear";

describe("escapeAction", () => {
  it("primero cierra el desplegable, después borra y, sin texto, saca el foco", () => {
    expect(escapeAction({ hasText: true, menuOpen: true })).toBe("closeMenu");
    expect(escapeAction({ hasText: true, menuOpen: false })).toBe("clear");
    expect(escapeAction({ hasText: false, menuOpen: false })).toBe("blur");
  });
});

describe("createClearer", () => {
  it("vuelve a buscar sin texto una sola vez aunque se borre dos veces seguidas (× y Escape)", async () => {
    const navigate = vi.fn();
    const clear = createClearer({ href: () => Promise.resolve("/search?intent=bars"), stillEmpty: () => true, navigate });
    await Promise.all([clear(), clear()]);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/search?intent=bars");
  });

  it("una vez terminada, otro borrado (de otra búsqueda) vuelve a navegar", async () => {
    const navigate = vi.fn();
    const clear = createClearer({ href: () => Promise.resolve("/search"), stillEmpty: () => true, navigate });
    await clear();
    await clear();
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it("en la home (sin URL) sólo borra: no navega", async () => {
    const navigate = vi.fn();
    await createClearer({ href: () => undefined, stillEmpty: () => true, navigate })();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("si se volvió a escribir antes de que llegue la URL, no busca sin texto", async () => {
    const navigate = vi.fn();
    await createClearer({ href: () => Promise.resolve("/search"), stillEmpty: () => false, navigate })();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("acepta el thenable de React (su then no devuelve una promesa)", async () => {
    const navigate = vi.fn();
    const thenable = { then: (resolve: (url: string) => void) => void resolve("/search?f=open%3Anow") } as unknown as PromiseLike<string>;
    await createClearer({ href: () => thenable, stillEmpty: () => true, navigate })();
    expect(navigate).toHaveBeenCalledWith("/search?f=open%3Anow");
  });

  it("si la URL falla, no navega ni rompe", async () => {
    const navigate = vi.fn();
    await expect(createClearer({ href: () => Promise.reject(new Error("x")), stillEmpty: () => true, navigate })()).resolves.toBeUndefined();
    expect(navigate).not.toHaveBeenCalled();
  });
});
