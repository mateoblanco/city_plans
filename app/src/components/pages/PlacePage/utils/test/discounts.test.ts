import { describe, expect, it } from "vitest";
import type { PlaceBenefit } from "@/server/discounts";
import { benefitCap, benefitDays, benefitHeadline, benefitLine, benefitMode, benefitRows } from "../discounts";

const benefit = (overrides: Partial<PlaceBenefit> = {}): PlaceBenefit => ({
  id: "b",
  percent: 25,
  cardType: "credit",
  cardTiers: [],
  cardProgram: null,
  days: "all",
  daysText: null,
  mode: "instant",
  instantPercent: 25,
  refundPercent: null,
  cap: null,
  conditions: null,
  sourceUrl: null,
  ...overrides,
});

describe("benefitHeadline", () => {
  it("porcentaje, tipo de tarjeta y niveles", () => {
    expect(benefitHeadline(benefit({ cardTiers: ["Platinum", "Select", "Private Banking"] }))).toBe("25% · Crédito Platinum, Select y Private Banking");
    expect(benefitHeadline(benefit({ cardType: "debit", percent: 12.5 }))).toBe("12,5% · Débito");
    expect(benefitHeadline(benefit({ cardType: "other", percent: 15 }))).toBe("15% · Cualquier tarjeta");
    expect(benefitHeadline(benefit({ cardTiers: ["Platinum"], cardProgram: "Nacional" }))).toBe("25% · Crédito Platinum · Tarjeta Nacional");
  });
});

describe("benefitDays", () => {
  it("sólo si no es todos los días", () => {
    expect(benefitDays(benefit())).toBeNull();
    expect(benefitDays(benefit({ days: ["fri", "mon", "wed"] }))).toBe("Lunes, miércoles y viernes");
    expect(benefitDays(benefit({ days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] }))).toBeNull();
    expect(benefitDays(benefit({ days: null, daysText: "de lunes a jueves" }))).toBe("De lunes a jueves");
    expect(benefitDays(benefit({ days: null, daysText: "Todos los días" }))).toBeNull();
    expect(benefitDays(benefit({ days: null }))).toBeNull();
  });
});

describe("benefitMode", () => {
  it("reintegro o mixta; en el momento no se muestra", () => {
    expect(benefitMode(benefit())).toBeNull();
    expect(benefitMode(benefit({ mode: "refund", instantPercent: null, refundPercent: 25 }))).toBe("reintegro");
    expect(benefitMode(benefit({ mode: "mixed", percent: 20, instantPercent: 10, refundPercent: 10 }))).toBe("10% en el momento + 10% de reintegro");
    expect(benefitMode(benefit({ mode: "unknown" }))).toBeNull();
  });

  it("la línea completa junta tarjeta, días y modalidad", () => {
    expect(benefitLine(benefit({ mode: "refund", days: ["sat", "sun"] }))).toBe("25% · Crédito · Sábado y domingo · reintegro");
    expect(benefitLine(benefit())).toBe("25% · Crédito");
  });
});

describe("benefitCap", () => {
  it("el texto del tope; sin tope (o \"Sin tope\") no hay", () => {
    const segment = "Private Banking hasta UYU 6.000, Select UYU 4.000, resto UYU 2.000 por mes (crédito y débito por separado)";
    expect(benefitCap(benefit({ cap: { text: segment, amount: null, currency: "UYU", period: "month" } }))).toBe(segment);
    expect(benefitCap(benefit({ cap: { text: "Sin tope", amount: null, currency: null, period: null } }))).toBeNull();
    expect(benefitCap(benefit())).toBeNull();
  });
});

describe("benefitRows", () => {
  const page = "https://banco/personalbank";
  const lines = (benefits: PlaceBenefit[]) => benefitRows(benefits).map((row) => benefitLine(row.benefit, row.cardTypes));

  it("junta los que sólo difieren en el tipo de tarjeta", () => {
    expect(lines([benefit({ id: "d", cardType: "debit", sourceUrl: page }), benefit({ id: "c", cardType: "credit", sourceUrl: page })])).toEqual(["25% · Débito y crédito"]);
  });

  it("con otros niveles, otra página, otro tope u otro porcentaje, quedan separados", () => {
    const tiers = ["Visa Infinite", "Mastercard Black"];
    expect(lines([benefit({ id: "d", cardType: "debit" }), benefit({ id: "c", cardTiers: tiers })])).toEqual(["25% · Débito", "25% · Crédito Visa Infinite y Mastercard Black"]);
    expect(lines([benefit({ id: "d", cardType: "debit", sourceUrl: "https://a" }), benefit({ id: "c", sourceUrl: "https://b" })])).toHaveLength(2);
    expect(lines([benefit({ id: "d", cardType: "debit", cap: { text: "UYU 2.000", amount: 2000, currency: "UYU", period: "month" } }), benefit({ id: "c" })])).toHaveLength(2);
    expect(lines([benefit({ id: "d", cardType: "debit", percent: 20 }), benefit({ id: "c" })])).toEqual(["20% · Débito", "25% · Crédito"]);
  });

  it("los niveles en otro orden cuentan como iguales; cada línea va donde estaba el primero", () => {
    const rows = benefitRows([
      benefit({ id: "a", cardType: "debit", cardTiers: ["Oro", "Platinum"] }),
      benefit({ id: "b", percent: 15 }),
      benefit({ id: "c", cardTiers: ["Platinum", "Oro"] }),
    ]);
    expect(rows.map((row) => [row.key, row.cardTypes])).toEqual([["a", ["debit", "credit"]], ["b", ["credit"]]]);
  });
});
