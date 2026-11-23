import type { MetadataRoute } from "next";
import { SITE_NAME } from "@/lib/site";

// Antes era manifest.webmanifest estático; como .ts toma el nombre de SITE_NAME. Se sirve en la misma URL.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    icons: [
      { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    theme_color: "#ffffff",
    background_color: "#ffffff",
    display: "standalone",
  };
}
