import { describe, expect, it } from "vitest";
import { jsonLdScript, placeJsonLd, schemaType, type JsonLdPlace } from "../structured-data";

const SITE = "https://salimos.uy";
const base: JsonLdPlace = { slug: "lugar", name: "Lugar", description_es: null, categories: [], tags: [], price: "unknown" };
const ld = (place: Partial<JsonLdPlace>, logoUrl: string | null = null, neighborhood: string | null = "Pocitos") =>
  placeJsonLd({ place: { ...base, ...place }, siteUrl: SITE, logoUrl, neighborhood });

// Lo único que puede tener: datos propios. Nada de Google (aggregateRating, openingHours, telephone, geo…).
const ALLOWED = ["@context", "@type", "name", "description", "url", "logo", "image", "servesCuisine", "priceRange", "address", "containedInPlace"];

describe("JSON-LD de la ficha", () => {
  it("un restaurante: tipo, cocinas, precio, logo, URL canónica y barrio", () => {
    const data = ld(
      { slug: "trouville", name: "Trouville", description_es: "  Pizzería clásica\n de Pocitos. ", categories: ["pizzeria", "restaurant"], tags: ["italian", "uruguayan", "terrace"], price: "moderate" },
      "https://logos.example/trouville.webp",
    );
    expect(data).toEqual({
      "@context": "https://schema.org",
      "@type": "Restaurant",
      name: "Trouville",
      description: "Pizzería clásica de Pocitos.",
      url: "https://salimos.uy/place/trouville",
      logo: "https://logos.example/trouville.webp",
      image: "https://logos.example/trouville.webp",
      servesCuisine: ["Italiana", "Uruguaya"],
      priceRange: "$$",
      address: { "@type": "PostalAddress", addressLocality: "Montevideo", addressCountry: "UY" },
      containedInPlace: { "@type": "Place", name: "Pocitos, Montevideo" },
    });
  });

  it("un café", () => {
    const data = ld({ slug: "cafe-x", name: "Café X", categories: ["cafe"], price: "low" });
    expect(data["@type"]).toBe("CafeOrCoffeeShop");
    expect(data.priceRange).toBe("$");
    expect(data).not.toHaveProperty("servesCuisine");
  });

  it("un bar (también cervecería y vinoteca)", () => {
    expect(ld({ categories: ["bar"], tags: ["mexican"], price: "high" })).toMatchObject({ "@type": "BarOrPub", servesCuisine: ["Mexicana"], priceRange: "$$$" });
    expect(schemaType(["brewery"])).toBe("BarOrPub");
    expect(schemaType(["wine_bar", "restaurant"])).toBe("BarOrPub");
  });

  it("lo que no es restaurante, café ni bar es LocalBusiness, sin servesCuisine", () => {
    for (const categories of [["bakery"], ["ice_cream_shop"], []]) {
      const data = ld({ categories, tags: ["italian"] });
      expect(data["@type"]).toBe("LocalBusiness");
      expect(data).not.toHaveProperty("servesCuisine");
    }
  });

  it("sin descripción, logo, precio ni barrio, esos campos no aparecen", () => {
    const data = ld({ categories: ["restaurant"], description_es: "   " }, null, null);
    for (const key of ["description", "logo", "image", "priceRange", "servesCuisine", "containedInPlace"]) expect(data).not.toHaveProperty(key);
  });

  it("sólo claves de datos propios (nada de Google ni coordenadas)", () => {
    const data = ld({ categories: ["restaurant"], tags: ["italian"], price: "moderate", description_es: "x" }, "https://l/x.webp");
    expect(Object.keys(data).every((key) => ALLOWED.includes(key))).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(/rating|openingHours|telephone|geo|latitude|longitude|streetAddress/i);
  });

  it("el script escapa `<` (un texto no puede cerrar el <script>)", () => {
    const text = jsonLdScript(ld({ description_es: "hola </script><script>alert(1)</script>" }));
    expect(text).not.toContain("</script>");
    expect(JSON.parse(text).description).toBe("hola </script><script>alert(1)</script>");
  });
});
