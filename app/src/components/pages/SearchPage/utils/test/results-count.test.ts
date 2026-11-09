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

describe("resultsAnnouncement", () => {
  it("sin resultados lo dice", () => expect(resultsAnnouncement(0)).toBe("No encontramos lugares"));
  it("si no, como el título", () => {
    expect(resultsAnnouncement(null)).toBe("Buscando…");
    expect(resultsAnnouncement(7)).toBe("7 lugares");
  });
});
