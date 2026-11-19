import { describe, expect, it } from "vitest";
import type { OpenStateText } from "@/server/search/labels";
import { mergeStatus } from "../status";

const open: OpenStateText = { tone: "open", prefix: "", status: "Abierto", detail: "Cierra 00:00" };
const closingSoon: OpenStateText = { tone: "closing_soon", prefix: "", status: "Cierra pronto", detail: "16:00" };
const closed: OpenStateText = { tone: "closed", prefix: "", status: "Cerrado", detail: "Abre hoy 19:00" };
const openingSoon: OpenStateText = { tone: "opening_soon", prefix: "", status: "Abre pronto", detail: "19:00" };
const GOOGLE_OPEN = { tone: "open", prefix: "", status: "Abierto", detail: null };
const GOOGLE_CLOSED = { tone: "closed", prefix: "", status: "Cerrado", detail: null };

describe("mergeStatus", () => {
  it("sin estado de la base: el de Google, sin detalle; sin ninguno, nada", () => {
    expect(mergeStatus(null, true)).toEqual(GOOGLE_OPEN);
    expect(mergeStatus(null, false)).toEqual(GOOGLE_CLOSED);
    expect(mergeStatus(null, null)).toBeNull();
  });

  it("la base y Google coinciden: el de la base, con su detalle", () => {
    expect(mergeStatus(open, true)).toBe(open);
    expect(mergeStatus(closingSoon, true)).toBe(closingSoon);
    expect(mergeStatus(closed, false)).toBe(closed);
    expect(mergeStatus(openingSoon, false)).toBe(openingSoon);
  });

  it("difieren: gana Google, sin detalle", () => {
    expect(mergeStatus(open, false)).toEqual(GOOGLE_CLOSED);
    expect(mergeStatus(closingSoon, false)).toEqual(GOOGLE_CLOSED);
    expect(mergeStatus(closed, true)).toEqual(GOOGLE_OPEN);
  });

  it("Google sin openNow: el de la base", () => {
    expect(mergeStatus(closed, null)).toBe(closed);
  });
});
