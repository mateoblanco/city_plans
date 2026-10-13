import { describe, expect, it } from "vitest";
import { searchHref } from "./search-href";

describe("searchHref", () => {
  it("suma el chip a los remove que ya estaban, sin duplicar", () => {
    const href = searchHref({ q: "brunch en cordón", remove: "tag:terrace", add: { kind: "neighborhood", id: "CORDON" } });
    const params = new URL(href, "http://x").searchParams;
    expect(params.get("q")).toBe("brunch en cordón");
    expect(params.get("remove")).toBe("tag:terrace,neighborhood:CORDON");
    expect(searchHref({ q: "a", remove: "tag:terrace", add: { kind: "tag", id: "terrace" } })).toBe("/search?q=a&remove=tag%3Aterrace");
  });

  it("conserva debug y omite remove vacío", () => {
    expect(searchHref({ q: "café & té", debug: true })).toBe("/search?q=caf%C3%A9+%26+t%C3%A9&debug=1");
    expect(searchHref({ q: "x", remove: " , " })).toBe("/search?q=x");
  });
});
