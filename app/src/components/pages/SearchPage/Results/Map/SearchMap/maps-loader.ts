"use client";

import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

// La clave de navegador del mapa (restringida por referrer), la misma que usa APIProvider.
export const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
export const MAPS_LANGUAGE = "es";
export const MAPS_REGION = "UY";

let started = false;

/**
 * Empieza a bajar Maps JS sin esperar el chunk dinámico de SearchMap: instala `google.maps.importLibrary` y pide las
 * librerías del mapa y de los marcadores. El script es async, no bloquea la lista. Cuando APIProvider (@vis.gl) se
 * monta, ve que `importLibrary` ya existe y lo reusa: no hay un segundo script. Mismos parámetros que el APIProvider.
 */
export function startMapsLoad() {
  if (started || !MAPS_API_KEY || typeof window === "undefined") return;
  started = true;
  setOptions({ key: MAPS_API_KEY, language: MAPS_LANGUAGE, region: MAPS_REGION });
  // Si falla, APIProvider lo vuelve a intentar y muestra su propio error: acá no hay nada que hacer.
  void Promise.all([importLibrary("maps"), importLibrary("marker")]).catch(() => {});
}
