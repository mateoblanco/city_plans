"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LOCATION_COOKIE, LOCATION_COOKIE_MAX_AGE, locationCookieValue, metersBetween, parseLocationCookie, type LatLng } from "@/lib/location";

/**
 * La ubicación de la persona para "Cerca mío": se pide al navegador, se redondea (~100 m) y va en la cookie `loc`, que
 * el servidor lee en cada búsqueda (la URL nunca la lleva). Lo que pasó con el pedido también va ahí: `denied` (no se
 * vuelve a pedir solo) o `skip` (falló o tardó: no se vuelve a pedir en esta sesión).
 */

const GEO_OPTIONS: PositionOptions = { timeout: 10000, maximumAge: 5 * 60 * 1000 };
/** Si la ubicación nueva está a más de esto de la guardada, se vuelve a buscar. */
const MOVED_M = 300;

function writeCookie(value: string, maxAge: number | null) {
  try {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    const age = maxAge === null ? "" : `; max-age=${maxAge}`;
    document.cookie = `${LOCATION_COOKIE}=${value}; path=/${age}; SameSite=Lax${secure}`;
  } catch {
    // Sin cookie, el servidor no sabe la ubicación: la próxima búsqueda la vuelve a pedir.
  }
}

const writeCoords = ({ lat, lng }: LatLng) => writeCookie(locationCookieValue(lat, lng), LOCATION_COOKIE_MAX_AGE.coords);
const writeDenied = () => writeCookie("denied", LOCATION_COOKIE_MAX_AGE.denied);
const writeSkip = () => writeCookie("skip", null);

export function readLocationCookie() {
  try {
    const entry = document.cookie.split("; ").find((part) => part.startsWith(`${LOCATION_COOKIE}=`));
    return parseLocationCookie(entry?.slice(LOCATION_COOKIE.length + 1));
  } catch {
    return null;
  }
}

export type LocateResult = "found" | "denied" | "failed";

/** Pide la ubicación (con el diálogo del navegador si hace falta) y deja el resultado en la cookie. */
export function requestLocation(): Promise<LocateResult> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      writeSkip();
      return resolve("failed");
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        writeCoords({ lat: coords.latitude, lng: coords.longitude });
        resolve("found");
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          writeDenied();
          resolve("denied");
        } else {
          writeSkip();
          resolve("failed");
        }
      },
      GEO_OPTIONS,
    );
  });
}

/** El permiso, sin preguntar: null si el navegador no lo dice (Safari viejo). */
async function permissionState(): Promise<PermissionState | null> {
  try {
    if (!navigator.permissions) return null;
    return (await navigator.permissions.query({ name: "geolocation" })).state;
  } catch {
    return null;
  }
}

type Refresh = () => void;

/**
 * Con el permiso ya dado, la ubicación actual sin diálogo. Si la persona se movió más de MOVED_M de `origin` (o no había
 * origin), la guarda y llama a refresh; si no, sólo renueva el vencimiento. Si retiró el permiso, guarda `denied` y
 * llama a refresh. Con el permiso sin dar (prompt) o sin Permissions API no hace nada: nunca lo pide. Devuelve cómo
 * cancelarlo.
 */
export function refreshGrantedLocation(origin: LatLng | null, refresh: Refresh): () => void {
  let cancelled = false;
  void permissionState().then((state) => {
    if (cancelled) return;
    if (state === "denied") {
      // Sin origin no había ubicación que sacar: sólo se guarda, no hace falta volver a buscar.
      writeDenied();
      if (origin) refresh();
      return;
    }
    if (state !== "granted") return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (cancelled) return;
        const next = { lat: coords.latitude, lng: coords.longitude };
        writeCoords(next);
        if (!origin || metersBetween(origin, next) > MOVED_M) refresh();
      },
      () => {},
      GEO_OPTIONS,
    );
  });
  return () => {
    cancelled = true;
  };
}

/**
 * Con cerca mío desde la cookie: en segundo plano, si el permiso sigue dado, actualiza la ubicación (sin diálogo). Si la
 * persona se movió más de MOVED_M, vuelve a buscar; si no, sólo renueva el vencimiento. Si retiró el permiso, guarda
 * `denied` y vuelve a buscar (todo Montevideo). Sin Permissions API no hace nada: no se pide solo.
 */
export function useRefreshLocation(origin: LatLng | null) {
  const router = useRouter();
  const lat = origin?.lat;
  const lng = origin?.lng;
  useEffect(() => {
    if (lat === undefined || lng === undefined) return;
    return refreshGrantedLocation({ lat, lng }, () => router.refresh());
  }, [lat, lng, router]);
}

/**
 * La home: nunca pide el permiso. Con coordenadas en la cookie, como useRefreshLocation; sin cookie y con el permiso ya
 * dado (de otra visita), la toma sin diálogo y vuelve a pedir la home, así sale "Abierto ahora cerca tuyo". Con `denied`
 * o `skip` en la cookie no hace nada.
 */
export function useHomeLocation() {
  const router = useRouter();
  useEffect(() => {
    const current = readLocationCookie();
    if (current && current.kind !== "coords") return;
    return refreshGrantedLocation(current, () => router.refresh());
  }, [router]);
}
