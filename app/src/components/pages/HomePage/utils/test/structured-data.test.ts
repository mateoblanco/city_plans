import { describe, expect, it } from "vitest";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { homeJsonLd } from "../structured-data";

describe("JSON-LD de la home", () => {
  it("WebSite (nombre, nombre alternativo y URL) y Organization (nombre y logo), con URLs absolutas del dominio", () => {
    const data = homeJsonLd(SITE_URL) as { "@graph": Record<string, unknown>[] };
    const [website, organization] = data["@graph"];
    expect(SITE_URL).toBe("https://www.adondevamos.com.uy");
    expect(website).toMatchObject({ "@type": "WebSite", name: SITE_NAME, alternateName: "adondevamos", url: "https://www.adondevamos.com.uy/" });
    expect(organization).toMatchObject({
      "@type": "Organization",
      name: SITE_NAME,
      url: "https://www.adondevamos.com.uy/",
      logo: "https://www.adondevamos.com.uy/android-chrome-512x512.png",
    });
    expect(website.publisher).toEqual({ "@id": organization["@id"] });
  });
});
