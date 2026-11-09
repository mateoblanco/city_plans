"use client";

import { createContext, use } from "react";

/**
 * Hover compartido entre la lista y el mapa de /search (lo provee MapSync). Va en su propio módulo, sin dependencias:
 * PlaceCard también se usa en la home y en la ficha, y si lo importara de MapSync se llevaría a esas páginas el Drawer,
 * el Select y el resto del panel de resultados.
 */
export type HoverState = { hoveredId: string | null; setHoveredId: (id: string | null) => void };

export const HoverContext = createContext<HoverState>({ hoveredId: null, setHoveredId: () => {} });

export const useHoveredPlace = () => use(HoverContext);

/** Id del elemento de la card (para hacer scroll a ella desde el mapa). */
export const cardId = (id: string) => `place-${id}`;
