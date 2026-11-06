import { describe, expect, it } from "vitest";
import { discountViewAllHref } from "../discount-sections";
import { setDiscountsHref } from "../search-href";

const read = (href: string) => Object.fromEntries(new URL(href, "http://x").searchParams);

describe("setDiscountsHref", () => {
  it("reemplaza los discount: de f y conserva el resto de f, q y near", () => {
    const state = { q: "pizza", f: "open:today,discount:bbva.debit,diet:vegan", near: "-34.905,-56.185" };
    expect(read(setDiscountsHref(state, ["itau.credit", "santander.debit"]))).toEqual({
      q: "pizza",
      f: "open:today,diet:vegan,discount:itau.credit,discount:santander.debit",
      near: "-34.905,-56.185",
    });
    expect(read(setDiscountsHref(state, []))).toEqual({ q: "pizza", f: "open:today,diet:vegan", near: "-34.905,-56.185" });
  });
});

describe("discountViewAllHref", () => {
  const state = { q: "", f: "discount:itau.credit,discount:itau-personal-bank.debit,discount:itau-personal-bank.credit,open:today" };

  it("'Ver todos' de un grupo por proveedor: sólo las elecciones de ese proveedor (sin confundir itau con itau-personal-bank)", () => {
    expect(read(discountViewAllHref(state, "discount:itau")!)).toEqual({ f: "open:today,discount:itau.credit" });
    expect(read(discountViewAllHref(state, "discount:itau-personal-bank")!)).toEqual({
      f: "open:today,discount:itau-personal-bank.debit,discount:itau-personal-bank.credit",
    });
  });

  it("null en los grupos que no son de descuento", () => {
    expect(discountViewAllHref(state, "outdoor")).toBeNull();
  });
});
