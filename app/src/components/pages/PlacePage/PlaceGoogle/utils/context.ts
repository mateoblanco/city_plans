"use client";

import { createContext, useContext } from "react";
import type { PlaceGoogleInfo } from "@/server/places/google";

/** pending: todavía no llegó (las partes de Google reservan su lugar); empty: no hay (sin Google, bot, límite, error). */
export type PlaceGoogleState = { status: "pending" } | { status: "ready"; info: PlaceGoogleInfo } | { status: "empty" };

export const PENDING: PlaceGoogleState = { status: "pending" };
export const EMPTY: PlaceGoogleState = { status: "empty" };

export const PlaceGoogleContext = createContext<PlaceGoogleState>(EMPTY);

/** Lo de Google de la ficha (PlaceGoogle). */
export const usePlaceGoogle = () => useContext(PlaceGoogleContext);

/** La info si ya llegó; null si está pendiente o no hay. */
export const googleInfo = (state: PlaceGoogleState) => (state.status === "ready" ? state.info : null);
