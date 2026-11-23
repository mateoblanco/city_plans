import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { guideMetadata } from "@/server/guides/metadata";
import type { Guide } from "@/server/guides/types";
import { DEFAULT_OG_IMAGE, SITE_NAME, SITE_URL } from "../site";

const APP = path.resolve(import.meta.dirname, "../../app");

describe("imagen para compartir por defecto", () => {
  it("las medidas de DEFAULT_OG_IMAGE son las de app/opengraph-image.jpg", async () => {
    const meta = await sharp(path.join(APP, "opengraph-image.jpg")).metadata();
    expect({ width: meta.width, height: meta.height, type: `image/${meta.format === "jpeg" ? "jpeg" : meta.format}` }).toEqual({
      width: DEFAULT_OG_IMAGE.width,
      height: DEFAULT_OG_IMAGE.height,
      type: DEFAULT_OG_IMAGE.type,
    });
  });

  it("el alt de la raíz (opengraph-image.alt.txt, texto fijo) es el de DEFAULT_OG_IMAGE, con SITE_NAME", () => {
    expect(fs.readFileSync(path.join(APP, "opengraph-image.alt.txt"), "utf8").trim()).toBe(`Logo de ${SITE_NAME}`);
    expect(DEFAULT_OG_IMAGE.alt).toBe(`Logo de ${SITE_NAME}`);
  });

  it("es relativa y la hace absoluta metadataBase, que es el dominio principal", () => {
    expect(DEFAULT_OG_IMAGE.url.startsWith("/")).toBe(true);
    expect(fs.readFileSync(path.join(APP, "layout.tsx"), "utf8")).toMatch(/metadataBase: new URL\(SITE_URL\)/);
    expect(new URL(DEFAULT_OG_IMAGE.url, SITE_URL).href).toBe("https://www.adondevamos.com.uy/opengraph-image.jpg");
  });

  it("las guías la llevan, con summary_large_image", () => {
    const metadata = guideMetadata({ slug: "primera-cita", title: "Primera cita", seoTitle: "t", seoDescription: "d", neighborhoodId: null } as unknown as Guide);
    expect(metadata.openGraph?.images).toEqual([DEFAULT_OG_IMAGE]);
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  });
});
