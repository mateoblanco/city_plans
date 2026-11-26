import { describe, expect, it } from "vitest";
import { freezeWhileResizing, type Size } from "../frozen-size";

const setup = () => {
  let emit: (size: Size) => void = () => {};
  const applied: (Size | null)[] = [];
  const timers: { run: () => void; cancelled: boolean }[] = [];
  let stopped = false;
  const cleanup = freezeWhileResizing({
    observe: (onSize) => {
      emit = onSize;
      return () => {
        stopped = true;
      };
    },
    apply: (size) => applied.push(size),
    wait: (run) => {
      const timer = { run, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  const flush = () => timers.filter((timer) => !timer.cancelled).forEach((timer) => ((timer.cancelled = true), timer.run()));
  return { emit: (width: number, height = 280) => emit({ width, height }), applied, timers, flush, cleanup, stopped: () => stopped };
};

describe("freezeWhileResizing", () => {
  it("el tamaño inicial no congela nada", () => {
    const t = setup();
    t.emit(800);
    expect(t.applied).toEqual([]);
  });

  it("al cambiar, fija el tamaño anterior y lo suelta una vez, cuando se queda quieto", () => {
    const t = setup();
    t.emit(800);
    t.emit(780);
    t.emit(760);
    t.emit(740);
    expect(t.applied).toEqual([{ width: 800, height: 280 }]);
    expect(t.timers.filter((timer) => !timer.cancelled)).toHaveLength(1);
    t.flush();
    expect(t.applied).toEqual([{ width: 800, height: 280 }, null]);
  });

  it("el siguiente resize congela en el tamaño nuevo", () => {
    const t = setup();
    t.emit(800);
    t.emit(700);
    t.flush();
    t.emit(650);
    expect(t.applied.at(-1)).toEqual({ width: 700, height: 280 });
  });

  it("también congela si cambia sólo el alto (mobile, 16:10)", () => {
    const t = setup();
    t.emit(400, 250);
    t.emit(400, 240);
    expect(t.applied).toEqual([{ width: 400, height: 250 }]);
  });

  it("la limpieza deja de observar, cancela la espera y suelta el tamaño", () => {
    const t = setup();
    t.emit(800);
    t.emit(700);
    t.cleanup();
    expect(t.stopped()).toBe(true);
    expect(t.timers.every((timer) => timer.cancelled)).toBe(true);
    expect(t.applied.at(-1)).toBeNull();
  });
});
