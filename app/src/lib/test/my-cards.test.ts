import { describe, expect, it } from "vitest";
import { MAX_MY_CARDS, myCardsCookieValue, parseCardKey, parseMyCardKeys, parseMyCardsCookie } from "../my-cards";

describe("mis tarjetas: formato proveedor.tipo", () => {
  it("lee proveedor y tipo del catálogo (con guiones en el proveedor)", () => {
    expect(parseCardKey("itau.credit")).toEqual({ provider: "itau", card: "credit" });
    expect(parseCardKey("itau-personal-bank.debit")).toEqual({ provider: "itau-personal-bank", card: "debit" });
  });

  it("descarta proveedores o tipos fuera del catálogo ('other' no se elige)", () => {
    for (const raw of ["banco.credit", "itau.other", "itau", ".credit", "itau.", ""]) expect(parseCardKey(raw)).toBeNull();
  });

  it("sin repetidas, sólo strings válidas, en orden y hasta el tope", () => {
    expect(parseMyCardKeys(["brou.debit", 3, "itau.credit", "brou.debit", "x.y"])).toEqual(["brou.debit", "itau.credit"]);
    const many = Array.from({ length: 40 }, (_, n) => (n % 2 ? "brou.debit" : `itau.${n % 4 ? "debit" : "credit"}`));
    expect(parseMyCardKeys(many).length).toBeLessThanOrEqual(MAX_MY_CARDS);
  });
});

describe("cookie de mis tarjetas", () => {
  it("ida y vuelta, codificada", () => {
    const value = myCardsCookieValue(["itau.credit", "brou.debit"]);
    expect(value).toBe("itau.credit%2Cbrou.debit");
    expect(parseMyCardsCookie(value)).toEqual(["itau.credit", "brou.debit"]);
    // Next ya la entrega decodificada.
    expect(parseMyCardsCookie("itau.credit,brou.debit")).toEqual(["itau.credit", "brou.debit"]);
  });

  it("vacía o con basura: ninguna", () => {
    for (const raw of [null, undefined, "", "%E0%A4%A", "a,b,c", "itau.credit;drop"]) expect(parseMyCardsCookie(raw)).toEqual([]);
    expect(myCardsCookieValue(["nada"])).toBe("");
  });
});
