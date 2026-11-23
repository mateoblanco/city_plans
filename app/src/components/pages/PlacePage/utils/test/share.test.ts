import { describe, expect, it, vi } from "vitest";
import { SITE_URL } from "@/lib/site";
import { copyLink, placeShareUrl, shareMessage, shareOrCopy, whatsappShareHref } from "../share";

const data = { title: "Bar Hispano", url: placeShareUrl("bar-hispano") };
const clipboard = () => ({ writeText: vi.fn(async () => {}) });

describe("URL que se comparte", () => {
  it("la canónica absoluta, sin parámetros ni hash", () => {
    expect(placeShareUrl("bar-hispano")).toBe("https://www.adondevamos.com.uy/place/bar-hispano");
    const url = new URL(placeShareUrl("bar-hispano"));
    expect(url.origin).toBe(SITE_URL);
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
  });

  it("WhatsApp: título y URL en el texto, codificados", () => {
    const href = whatsappShareHref("Café & Co", placeShareUrl("cafe-co"));
    expect(href).toBe(`https://wa.me/?text=${encodeURIComponent(`Café & Co ${SITE_URL}/place/cafe-co`)}`);
    expect(new URL(href).searchParams.get("text")).toBe(`Café & Co ${SITE_URL}/place/cafe-co`);
  });
});

describe("con navigator.share (mobile)", () => {
  it("abre el menú nativo con el título y la URL, y no copia", async () => {
    const share = vi.fn(async () => {});
    const env = { share, clipboard: clipboard() };
    expect(await shareOrCopy(data, env)).toBe("shared");
    expect(share).toHaveBeenCalledWith({ title: "Bar Hispano", url: "https://www.adondevamos.com.uy/place/bar-hispano" });
    expect(env.clipboard.writeText).not.toHaveBeenCalled();
    expect(shareMessage("shared")).toBeNull();
  });

  it("cerrar el menú sin compartir (AbortError): ni error, ni aviso, ni copia", async () => {
    const share = vi.fn(async () => {
      throw new DOMException("Share canceled", "AbortError");
    });
    const env = { share, clipboard: clipboard() };
    const result = await shareOrCopy(data, env);
    expect(result).toBe("cancelled");
    expect(shareMessage(result)).toBeNull();
    expect(env.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("otro error del menú nativo (p. ej. NotAllowedError): copia", async () => {
    const share = vi.fn(async () => {
      throw new DOMException("Not allowed", "NotAllowedError");
    });
    const env = { share, clipboard: clipboard() };
    expect(await shareOrCopy(data, env)).toBe("copied");
    expect(env.clipboard.writeText).toHaveBeenCalledWith(data.url);
  });
});

describe("sin navigator.share", () => {
  it("copia la URL canónica y avisa 'Link copiado'", async () => {
    const env = { clipboard: clipboard() };
    const result = await shareOrCopy(data, env);
    expect(result).toBe("copied");
    expect(env.clipboard.writeText).toHaveBeenCalledWith("https://www.adondevamos.com.uy/place/bar-hispano");
    expect(shareMessage(result)).toBe("Link copiado");
  });

  it("si no se puede copiar (sin portapapeles o sin permiso), lo dice", async () => {
    expect(await copyLink(data.url, {})).toBe("failed");
    const denied = { writeText: vi.fn(async () => Promise.reject(new DOMException("Denied", "NotAllowedError"))) };
    expect(await copyLink(data.url, { clipboard: denied })).toBe("failed");
    expect(shareMessage("failed")).toBe("No se pudo copiar el link");
  });
});
