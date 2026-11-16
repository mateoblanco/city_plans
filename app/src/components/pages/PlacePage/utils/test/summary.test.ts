import { describe, expect, it } from "vitest";
import type { Hours } from "@/server/search/hours";
import { baseHoursKnown, googleMapsHref, instagramHandle, instagramPopularHref, mainCategory, isNearWhite, placeOpenText, priceText, ratingInfo, ratingText, countText, toneOn } from "../summary";

describe("línea de info", () => {
  it("precio en signos con su nivel, y el texto accesible; desconocido no se muestra", () => {
    expect(priceText("low")).toEqual({ signs: "$", level: "Accesible", label: "Precio: accesible" });
    expect(priceText("moderate")).toEqual({ signs: "$$", level: "Normal", label: "Precio: normal" });
    expect(priceText("high")).toEqual({ signs: "$$$", level: "Caro", label: "Precio: caro" });
    expect(priceText("unknown")).toBeNull();
  });

  it("cantidad de reseñas con punto de miles", () => {
    expect(countText(12)).toBe("12");
    expect(countText(1230)).toBe("1.230");
    expect(countText(1234567)).toBe("1.234.567");
  });

  it("puntaje con cantidad y link; sin link de reseñas, el del lugar; sin puntaje, nada", () => {
    const google = { rating: 4.4, ratingCount: 1230, reviewsHref: "https://www.google.com/maps/reviews" };
    expect(ratingInfo(google, "https://fallback")).toEqual({ value: "4,4", count: "1.230", href: google.reviewsHref });
    expect(ratingInfo({ ...google, reviewsHref: null, ratingCount: null }, "https://fallback")).toEqual({ value: "4,4", count: null, href: "https://fallback" });
    expect(ratingInfo({ ...google, rating: null }, "https://fallback")).toBeNull();
    expect(ratingInfo(null, "https://fallback")).toBeNull();
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

describe("isNearWhite", () => {
  it("blanco y casi blanco son claros", () => {
    expect(isNearWhite("#ffffff")).toBe(true);
    expect(isNearWhite("#FFFFFF")).toBe(true);
    expect(isNearWhite("#f7f7f7")).toBe(true);
    expect(isNearWhite("#fff8e6")).toBe(true);
  });

  it("gris claro, amarillo y oscuros no", () => {
    expect(isNearWhite("#e0e0e0")).toBe(false);
    expect(isNearWhite("#ededed")).toBe(false);
    expect(isNearWhite("#fef200")).toBe(false);
    expect(isNearWhite("#24502f")).toBe(false);
    expect(isNearWhite("#000000")).toBe(false);
  });

  it("sin color o inválido, no", () => {
    expect(isNearWhite(null)).toBe(false);
    expect(isNearWhite("")).toBe(false);
    expect(isNearWhite("blanco")).toBe(false);
    expect(isNearWhite("#fff")).toBe(false);
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

  it("con los horarios de la base, mayúscula inicial en las dos partes", () => {
    expect(line(placeOpenText(lunch, null, { day: 1, time: "20:00" }))).toBe("Abierto · Cierra 00:00");
    expect(placeOpenText(lunch, null, { day: 1, time: "15:30" })).toMatchObject({ tone: "closing_soon", status: "Cierra pronto", detail: "16:00" });
    expect(placeOpenText(lunch, null, { day: 1, time: "16:30" })).toMatchObject({ tone: "closed", status: "Cerrado", detail: "Abre hoy 19:00" });
  });

  it("cerrado: abre hoy, mañana o el día de la semana", () => {
    const week: Hours = { status: "exact", slots: [{ day: 1, opens: "12:30", closes: "16:00" }, { day: 3, opens: "16:30", closes: "23:00" }] };
    expect(line(placeOpenText(week, null, { day: 0, time: "20:00" }))).toBe("Cerrado · Abre mañana 12:30");
    expect(line(placeOpenText(week, null, { day: 1, time: "17:00" }))).toBe("Cerrado · Abre el miércoles 16:30");
    expect(line(placeOpenText(week, null, { day: 3, time: "10:00" }))).toBe("Cerrado · Abre hoy 16:30");
  });

  it("baseHoursKnown: con horarios de la base el estado no espera a Google; sin ellos, sí", () => {
    expect(baseHoursKnown(lunch, { day: 1, time: "16:30" })).toBe(true);
    expect(baseHoursKnown(none, { day: 1, time: "16:30" })).toBe(false);
    // Lo que se muestra sin Google es lo mismo que con Google cuando la base lo sabe.
    expect(placeOpenText(lunch, null, { day: 1, time: "20:00" })).toEqual(placeOpenText(lunch, false, { day: 1, time: "20:00" }));
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
