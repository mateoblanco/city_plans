import { describe, expect, it } from "vitest";
import type { Hours } from "@/server/search/hours";
import { googleMapsHref, instagramHandle, instagramPopularHref, mainCategory, placeOpenText, priceLabel, ratingText, toneOn } from "../summary";

describe("línea de info", () => {
  it("precio con signos y etiqueta; desconocido no se muestra", () => {
    expect(priceLabel("low")).toBe("$ (Accesible)");
    expect(priceLabel("moderate")).toBe("$$ (Normal)");
    expect(priceLabel("high")).toBe("$$$ (Caro)");
    expect(priceLabel("unknown")).toBeNull();
  });

  it("una sola categoría, la principal", () => {
    expect(mainCategory(["bar", "restaurant"])).toBe("Bar");
    expect(mainCategory([])).toBeNull();
  });

  it("puntaje con un decimal", () => {
    expect(ratingText(4.6)).toBe("4,6");
    expect(ratingText(5)).toBe("5,0");
  });
});

describe("instagramHandle", () => {
  it("limpia @, URL y barra final", () => {
    expect(instagramHandle("@marlon.bar")).toBe("marlon.bar");
    expect(instagramHandle("https://www.instagram.com/marlon_bar/?hl=es")).toBe("marlon_bar");
    expect(instagramHandle("  ")).toBeNull();
    expect(instagramHandle(null)).toBeNull();
    expect(instagramHandle("no válido")).toBeNull();
  });
});

describe("googleMapsHref", () => {
  it("link por place_id", () => {
    expect(googleMapsHref("Marlon Bar", "ChIJ123")).toBe("https://www.google.com/maps/search/?api=1&query=Marlon+Bar&query_place_id=ChIJ123");
  });
});

describe("toneOn", () => {
  it("texto claro sobre fondo oscuro y oscuro sobre claro", () => {
    expect(toneOn("#24502f")).toBe("light");
    expect(toneOn("#000000")).toBe("light");
    expect(toneOn("#f4bc07")).toBe("dark");
    expect(toneOn("#ffffff")).toBe("dark");
    expect(toneOn("verde")).toBeNull();
  });
});

describe("instagramPopularHref", () => {
  it("nombre con guiones, sin tildes ni signos, más -montevideo", () => {
    expect(instagramPopularHref("Amelie Bar & Bistro")).toBe("https://www.instagram.com/popular/amelie-bar-bistro-montevideo/?hl=es");
    expect(instagramPopularHref("Café Suárez")).toBe("https://www.instagram.com/popular/cafe-suarez-montevideo/?hl=es");
    expect(instagramPopularHref("  ¡! ")).toBeNull();
  });

  it("si el nombre ya dice Montevideo o MVD, no agrega la ciudad", () => {
    expect(instagramPopularHref("Yuzu Izakaya MVD")).toBe("https://www.instagram.com/popular/yuzu-izakaya-mvd/?hl=es");
    expect(instagramPopularHref("Hotel Montevideo")).toBe("https://www.instagram.com/popular/hotel-montevideo/?hl=es");
    expect(instagramPopularHref("Montevideo Brew House")).toBe("https://www.instagram.com/popular/montevideo-brew-house/?hl=es");
  });
});

describe("placeOpenText", () => {
  const lunch: Hours = { status: "exact", slots: [{ day: 1, opens: "12:00", closes: "16:00" }, { day: 1, opens: "19:00", closes: "00:00" }] };
  const none: Hours = { status: "none", slots: [] };
  const line = (text: ReturnType<typeof placeOpenText>) => text && (text.detail ? `${text.status} · ${text.detail}` : text.status);

  it("los mismos textos que la card, con los horarios de la base", () => {
    expect(line(placeOpenText(lunch, null, { day: 1, time: "20:00" }))).toBe("Abierto · cierra 00:00");
    expect(placeOpenText(lunch, null, { day: 1, time: "15:30" })).toMatchObject({ tone: "closing_soon", status: "Cierra pronto", detail: "16:00" });
    expect(placeOpenText(lunch, null, { day: 1, time: "16:30" })).toMatchObject({ tone: "closed", status: "Cerrado", detail: "Abre 19:00" });
  });

  it("los horarios de la base mandan sobre el abierto de Google", () => {
    expect(placeOpenText(lunch, true, { day: 1, time: "16:30" })?.tone).toBe("closed");
  });

  it("sin horarios confirmados: abierto/cerrado de Google, y sin eso no se muestra", () => {
    expect(placeOpenText(none, true, { day: 1, time: "20:00" })).toEqual({ tone: "open", prefix: "", status: "Abierto", detail: null });
    expect(placeOpenText(none, false, { day: 1, time: "20:00" })).toMatchObject({ tone: "closed", status: "Cerrado", detail: null });
    expect(placeOpenText(none, null, { day: 1, time: "20:00" })).toBeNull();
  });
});
