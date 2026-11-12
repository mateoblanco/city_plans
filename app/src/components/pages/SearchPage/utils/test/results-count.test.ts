import { describe, expect, it } from "vitest";
import { resultsAnnouncement, resultsCountLabel } from "../results-count";

describe("resultsCountLabel", () => {
  it("dice Buscando… mientras busca", () => expect(resultsCountLabel(null)).toBe("Buscando…"));
  it("singular y plural, con separador de miles", () => {
    expect(resultsCountLabel(1)).toBe("1 lugar");
    expect(resultsCountLabel(42)).toBe("42 lugares");
    expect(resultsCountLabel(1234)).toBe("1.234 lugares");
  });
});

describe("con Cerca de <barrio>", () => {
  const nearby = (count: number, only = false) => ({ label: "Palermo", count, only });
  it("separa el barrio de los cercanos", () => {
    expect(resultsCountLabel(18, nearby(6))).toBe("18 lugares en Palermo · 6 cerca");
    expect(resultsCountLabel(1, nearby(1))).toBe("1 lugar en Palermo · 1 cerca");
    expect(resultsAnnouncement(18, nearby(6))).toBe("18 lugares en Palermo · 6 cerca");
  });
  it("sin nada en el barrio, sólo los cercanos", () => {
    expect(resultsCountLabel(0, nearby(6))).toBe("6 cerca de Palermo");
    expect(resultsAnnouncement(0, nearby(6))).toBe("No encontramos en Palermo · 6 cerca");
  });
  it("sin cercanos, como siempre; en su Ver todos, los cercanos", () => {
    expect(resultsCountLabel(18, nearby(0))).toBe("18 lugares");
    expect(resultsCountLabel(12, nearby(12, true))).toBe("12 lugares cerca de Palermo");
    expect(resultsAnnouncement(0, nearby(0, true))).toBe("No encontramos lugares");
  });
});

describe("resultsAnnouncement", () => {
  it("sin resultados lo dice", () => expect(resultsAnnouncement(0)).toBe("No encontramos lugares"));
  it("si no, como el título", () => {
    expect(resultsAnnouncement(null)).toBe("Buscando…");
    expect(resultsAnnouncement(7)).toBe("7 lugares");
  });
});
