import { describe, expect, it, vi } from "vitest";
import { scheduleMount, type MountDeps } from "../deferred-mount";

/** Un navegador de mentira: se controla el load, la visibilidad del recuadro, el ancho y el idle. */
function fakeBrowser(options: { loaded?: boolean; desktop?: boolean } = {}) {
  const queryListeners = new Set<() => void>();
  const state = {
    loaded: options.loaded ?? true,
    loadRun: null as (() => void) | null,
    visibleChange: null as ((visible: boolean) => void) | null,
    idleRuns: [] as Array<() => void>,
    observed: false,
  };
  const query = {
    matches: options.desktop ?? true,
    addEventListener: (_: string, fn: () => void) => queryListeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => queryListeners.delete(fn),
  };
  const deps = {
    query,
    loaded: () => state.loaded,
    onLoad: (run: () => void) => {
      state.loadRun = run;
      return () => (state.loadRun = null);
    },
    observe: (onChange: (visible: boolean) => void) => {
      state.observed = true;
      state.visibleChange = onChange;
      return () => {
        state.observed = false;
        state.visibleChange = null;
      };
    },
    idle: (run: () => void) => {
      state.idleRuns.push(run);
      return () => (state.idleRuns = state.idleRuns.filter((r) => r !== run));
    },
  } as unknown as MountDeps;
  return {
    deps,
    state,
    load: () => state.loadRun?.(),
    setVisible: (visible: boolean) => state.visibleChange?.(visible),
    setDesktop: (matches: boolean) => {
      query.matches = matches;
      for (const fn of [...queryListeners]) fn();
    },
    flushIdle: () => state.idleRuns.splice(0).forEach((run) => run()),
  };
}

describe("scheduleMount (mapa interactivo de la ficha)", () => {
  it("no se monta con el recuadro fuera de pantalla; sí cuando entra, con el navegador libre, una sola vez", () => {
    const browser = fakeBrowser();
    const mount = vi.fn();
    scheduleMount(browser.deps, mount);
    browser.flushIdle();
    expect(mount).not.toHaveBeenCalled();

    browser.setVisible(true);
    expect(mount).not.toHaveBeenCalled();
    browser.flushIdle();
    expect(mount).toHaveBeenCalledTimes(1);

    browser.setVisible(false);
    browser.setVisible(true);
    browser.flushIdle();
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it("espera al load de la página aunque el recuadro ya esté visible", () => {
    const browser = fakeBrowser({ loaded: false });
    const mount = vi.fn();
    scheduleMount(browser.deps, mount);
    browser.setVisible(true);
    browser.flushIdle();
    expect(mount).not.toHaveBeenCalled();
    browser.load();
    browser.flushIdle();
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it("debajo del breakpoint (mobile) nunca; si la ventana se agranda con el recuadro visible, en ese momento", () => {
    const browser = fakeBrowser({ desktop: false });
    const mount = vi.fn();
    scheduleMount(browser.deps, mount);
    browser.setVisible(true);
    browser.flushIdle();
    expect(mount).not.toHaveBeenCalled();
    browser.setDesktop(true);
    browser.flushIdle();
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it("la limpieza (desmontar antes) cancela lo pendiente y deja de observar", () => {
    const browser = fakeBrowser();
    const mount = vi.fn();
    const cleanup = scheduleMount(browser.deps, mount);
    browser.setVisible(true);
    cleanup();
    browser.flushIdle();
    expect(mount).not.toHaveBeenCalled();
    expect(browser.state.observed).toBe(false);
  });
});
