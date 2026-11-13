import { describe, expect, it } from "vitest";
import { discountRows, inOptionOrder } from "@/components/DiscountChoices/utils/options";
import { initialDiscountSelection, shouldSaveCards } from "../initial";

const providers = [
  { id: "brou", name: "BROU", cardTypes: ["debit"] },
  { id: "itau", name: "Itaú", cardTypes: ["credit"] },
  { id: "santander", name: "Santander", cardTypes: ["other"] },
];
const keys = discountRows(providers).options.map((option) => option.key);

describe("panel de Descuentos con mis tarjetas", () => {
  it("sin descuentos en la URL, aparecen marcadas mis tarjetas (sólo las que tienen chip)", () => {
    expect(initialDiscountSelection([], ["itau.credit", "itau.debit", "santander.debit"], keys)).toEqual(["itau.credit", "santander.debit"]);
  });

  it("con descuentos en la URL, manda la URL", () => {
    expect(initialDiscountSelection(["brou.debit"], ["itau.credit"], keys)).toEqual(["brou.debit"]);
  });

  it("sin tarjetas guardadas, nada marcado", () => {
    expect(initialDiscountSelection([], [], keys)).toEqual([]);
  });

  it("al aplicar se guardan; sacar todos los descuentos no borra mis tarjetas", () => {
    expect(shouldSaveCards(["itau.credit"])).toBe(true);
    expect(shouldSaveCards([])).toBe(false);
  });
});

describe("opciones del panel", () => {
  it("'other' cuenta como débito y crédito; lo de la URL conserva su chip aunque no tenga beneficios", () => {
    expect(keys).toEqual(["brou.debit", "itau.credit", "santander.debit", "santander.credit"]);
    expect(discountRows(providers, ["itau.debit"]).options.map((option) => option.key)).toContain("itau.debit");
  });

  it("ordena lo elegido como las opciones", () => {
    expect(inOptionOrder(discountRows(providers).options, ["santander.credit", "brou.debit"])).toEqual(["brou.debit", "santander.credit"]);
  });
});
