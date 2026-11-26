import { describe, expect, it } from "vitest";
import { jsonLdScript, openingHours, placeJsonLd, sameAs, schemaType, type JsonLdPlace } from "../structured-data";

const SITE = "https://sitio.example";
const NO_HOURS = { slots: [], status: "none" as const };
const base: JsonLdPlace = { slug: "lugar", name: "Lugar", description_es: null, categories: [], tags: [], price: "unknown", hours: NO_HOURS, instagram: null, website: null };
const ld = (place: Partial<JsonLdPlace>, logoUrl: string | null = null, neighborhood: string | null = "Pocitos") =>
  placeJsonLd({ place: { ...base, ...place }, siteUrl: SITE, logoUrl, neighborhood });

// Lo único que puede tener: datos propios. Nada de Google (aggregateRating, openingHours, telephone, geo…).
// openingHoursSpecification y sameAs son los de la base (fuentes propias), nunca los de Google.
const ALLOWED = ["@context", "@type", "name", "description", "url", "logo", "image", "servesCuisine", "priceRange", "address", "containedInPlace", "openingHoursSpecification", "sameAs"];

describe("JSON-LD de la ficha", () => {
  it("un restaurante: tipo, cocinas, precio, logo, URL canónica y barrio", () => {
    const data = ld(
      { slug: "trouville", name: "Trouville", description_es: "  Pizzería clásica\n de Pocitos. ", categories: ["pizzeria", "restaurant"], tags: ["italian", "uruguayan", "outdoor"], price: "moderate" },
      "https://logos.example/trouville.webp",
    );
    expect(data).toEqual({
      "@context": "https://schema.org",
      "@type": "Restaurant",
      name: "Trouville",
      description: "Pizzería clásica de Pocitos.",
      url: "https://sitio.example/place/trouville",
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

  it("panadería y heladería con su tipo de comida; lo demás, LocalBusiness sin servesCuisine", () => {
    expect(ld({ categories: ["bakery"], tags: ["french"] })).toMatchObject({ "@type": "Bakery", servesCuisine: ["Francesa"] });
    expect(ld({ categories: ["ice_cream_shop"] })["@type"]).toBe("IceCreamShop");
    for (const categories of [["otra"], []]) {
      const data = ld({ categories, tags: ["italian"] });
      expect(data["@type"]).toBe("LocalBusiness");
      expect(data).not.toHaveProperty("servesCuisine");
    }
  });

  it("sin descripción, logo, precio ni barrio, esos campos no aparecen", () => {
    const data = ld({ categories: ["restaurant"], description_es: "   " }, null, null);
    for (const key of ["description", "logo", "image", "priceRange", "servesCuisine", "containedInPlace"]) expect(data).not.toHaveProperty(key);
  });

  it("horarios propios completos: openingHoursSpecification con los días juntos por turno, lunes primero", () => {
    const hours = {
      status: "exact" as const,
      slots: [
        { day: 0, opens: "09:00", closes: "14:00" },
        { day: 1, opens: "09:00", closes: "14:00" },
        { day: 5, opens: "20:00", closes: "02:00" },
        { day: 6, opens: "20:00", closes: "02:00" },
      ],
    };
    expect(ld({ categories: ["bar"], hours }).openingHoursSpecification).toEqual([
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["https://schema.org/Monday", "https://schema.org/Sunday"], opens: "09:00", closes: "14:00" },
      // Pasa la medianoche: el cierre queda antes que la apertura.
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["https://schema.org/Friday", "https://schema.org/Saturday"], opens: "20:00", closes: "02:00" },
    ]);
  });

  it("horarios incompletos, vagos o sin cierre no van", () => {
    const slots = [{ day: 1, opens: "09:00", closes: "14:00" }];
    for (const status of ["partial", "vague", "none"] as const) expect(openingHours({ status, slots })).toEqual([]);
    expect(openingHours({ status: "exact", slots: [{ day: 1, opens: "19:00", closes: null }, { day: 9, opens: "09:00", closes: "10:00" }, { day: 2, opens: "9", closes: "10:00" }] })).toEqual([]);
    expect(ld({ categories: ["bar"], hours: { status: "partial", slots } })).not.toHaveProperty("openingHoursSpecification");
  });

  it("sameAs: el Instagram (como URL de perfil) y la web propia", () => {
    expect(sameAs({ instagram: "@ramona.cafe", website: "ramona.com.uy" })).toEqual(["https://www.instagram.com/ramona.cafe/", "https://ramona.com.uy/"]);
    expect(sameAs({ instagram: "https://www.instagram.com/ramona.cafe/?hl=es", website: "https://ramona.com.uy/menu" })).toEqual([
      "https://www.instagram.com/ramona.cafe/",
      "https://ramona.com.uy/menu",
    ]);
    expect(sameAs({ instagram: "no es un handle!", website: "nada" })).toEqual([]);
    expect(ld({ instagram: null, website: null })).not.toHaveProperty("sameAs");
  });

  it("sólo claves de datos propios (nada de Google ni coordenadas)", () => {
    const hours = { status: "exact" as const, slots: [{ day: 1, opens: "09:00", closes: "14:00" }] };
    const data = ld({ categories: ["restaurant"], tags: ["italian"], price: "moderate", description_es: "x", hours, instagram: "lugar", website: "lugar.uy" }, "https://l/x.webp");
    expect(Object.keys(data).every((key) => ALLOWED.includes(key))).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(/rating|review|telephone|geo|latitude|longitude|streetAddress|postalCode/i);
  });

  it("el script escapa `<` (un texto no puede cerrar el <script>)", () => {
    const text = jsonLdScript(ld({ description_es: "hola </script><script>alert(1)</script>" }));
    expect(text).not.toContain("</script>");
    expect(JSON.parse(text).description).toBe("hola </script><script>alert(1)</script>");
  });
});
