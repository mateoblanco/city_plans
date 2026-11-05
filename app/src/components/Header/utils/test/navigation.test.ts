import { beforeEach, describe, expect, it } from "vitest";
import { hasInAppHistory, recordPath, resetNavigation } from "../navigation";

describe("navegación dentro de la app", () => {
  beforeEach(resetNavigation);

  it("la primera página no cuenta como historial", () => {
    recordPath("/place/marlon");
    expect(hasInAppHistory()).toBe(false);
  });

  it("el mismo pathname otra vez (re-render, cambio de query) no cuenta", () => {
    recordPath("/search");
    recordPath("/search");
    expect(hasInAppHistory()).toBe(false);
  });

  it("pasar a otra página sí", () => {
    recordPath("/search");
    recordPath("/place/marlon");
    expect(hasInAppHistory()).toBe(true);
  });
});
