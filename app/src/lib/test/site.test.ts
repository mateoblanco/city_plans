import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { SITE_NAME, withSiteName } from "../site";

describe("nombre de la app", () => {
  it("los títulos terminan en el nombre y el manifest lo usa", () => {
    expect(withSiteName("Cafés en Cordón")).toBe(`Cafés en Cordón · ${SITE_NAME}`);
    expect(manifest()).toMatchObject({ name: SITE_NAME, short_name: SITE_NAME });
  });
});
