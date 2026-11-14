import { describe, expect, it } from "vitest";
import { FLICK_VELOCITY, isTap, momentumStep, nextSnapPoint, releaseSnap, SHEET_HIGH, SHEET_LOW, SHEET_MID, splitDrag, TAP_SLOP_PX, toSnapPoint } from "../sheet";

describe("toSnapPoint", () => {
  it("acepta sólo las tres alturas del panel y baja cualquier otra cosa (cerrar)", () => {
    expect(toSnapPoint(SHEET_MID)).toBe(SHEET_MID);
    expect(toSnapPoint(SHEET_HIGH)).toBe(SHEET_HIGH);
    expect(toSnapPoint(SHEET_LOW)).toBe(SHEET_LOW);
    expect(toSnapPoint("120px")).toBe(SHEET_LOW);
    expect(toSnapPoint(null)).toBe(SHEET_LOW);
    expect(toSnapPoint(0.7)).toBe(SHEET_LOW);
  });
});

describe("manija del panel", () => {
  it("alterna entre la media y la alta; desde la baja, a la media", () => {
    expect(nextSnapPoint(SHEET_MID)).toBe(SHEET_HIGH);
    expect(nextSnapPoint(SHEET_HIGH)).toBe(SHEET_MID);
    expect(nextSnapPoint(SHEET_LOW)).toBe(SHEET_MID);
  });

  it("un toque cuenta; el final de un arrastre no", () => {
    const down = { x: 100, y: 500 };
    expect(isTap(down, { x: 103, y: 504, detail: 1 })).toBe(true);
    expect(isTap(down, { x: 100, y: 500 + TAP_SLOP_PX + 1, detail: 1 })).toBe(false);
    expect(isTap(down, { x: 100, y: 300, detail: 1 })).toBe(false);
  });

  it("con teclado (detail 0) siempre cuenta", () => {
    expect(isTap(null, { x: 0, y: 0, detail: 0 })).toBe(true);
    expect(isTap({ x: 0, y: 0 }, { x: 0, y: 400, detail: 0 })).toBe(true);
  });
});

describe("splitDrag (subir el panel scrolleando)", () => {
  const distance = 300;

  it("el dedo hacia arriba mueve el panel hasta la alta; lo que sobra es scroll de la lista, en el mismo gesto", () => {
    expect(splitDrag(0, -40, distance)).toEqual({ drag: -40, overflow: 0 });
    expect(splitDrag(-280, -50, distance)).toEqual({ drag: -300, overflow: 30 });
    // Ya en la alta: todo es scroll.
    expect(splitDrag(-300, -25, distance)).toEqual({ drag: -300, overflow: 25 });
  });

  it("volver hacia abajo baja el panel, pero nunca debajo de la media", () => {
    expect(splitDrag(-100, 30, distance)).toEqual({ drag: -70, overflow: 0 });
    expect(splitDrag(-10, 50, distance)).toEqual({ drag: 0, overflow: 0 });
  });

  it("sumar los tramos da lo mismo que un solo movimiento (sin saltos)", () => {
    let drag = 0;
    let scrolled = 0;
    for (const delta of [-60, -60, -60, -60, -60, -60]) {
      const step = splitDrag(drag, delta, distance);
      drag = step.drag;
      scrolled += step.overflow;
    }
    expect(drag).toBe(-300);
    expect(scrolled).toBe(60);
  });
});

describe("releaseSnap", () => {
  const distance = 300;

  it("lento: a la más cercana", () => {
    expect(releaseSnap(-100, distance, 0)).toBe(SHEET_MID);
    expect(releaseSnap(-150, distance, 0)).toBe(SHEET_HIGH);
    expect(releaseSnap(-260, distance, -0.1)).toBe(SHEET_HIGH);
  });

  it("rápido: por la dirección", () => {
    expect(releaseSnap(-30, distance, -FLICK_VELOCITY)).toBe(SHEET_HIGH);
    expect(releaseSnap(-260, distance, FLICK_VELOCITY)).toBe(SHEET_MID);
  });
});

describe("momentumStep", () => {
  it("frena de a poco y se detiene", () => {
    let velocity = -2;
    let moved = 0;
    let frames = 0;
    for (let step = momentumStep(velocity, 16); step; step = momentumStep(velocity, 16)) {
      moved += step.delta;
      velocity = step.velocity;
      frames++;
    }
    expect(moved).toBeLessThan(0);
    expect(frames).toBeGreaterThan(10);
    expect(frames).toBeLessThan(200);
  });

  it("la fricción no depende de los fps", () => {
    expect(momentumStep(1, 32)!.velocity).toBeCloseTo(momentumStep(momentumStep(1, 16)!.velocity, 16)!.velocity);
  });
});
