"use client";

import { createContext, use, useSyncExternalStore } from "react";

/**
 * Hover compartido entre la lista y el mapa de /search (lo crea y lo provee el host del mapa, MapSync). Va en su propio
 * módulo, sin dependencias: PlaceCard también se usa en la home y en la ficha, y si lo importara de MapSync se llevaría
 * a esas páginas el Drawer, el Select y el resto del panel de resultados.
 *
 * Es un store externo y estable (el contexto nunca cambia): cada card y cada marcador se suscriben sólo a si su id es el
 * resaltado, así un hover re-renderiza la card que entra, la que sale y sus marcadores, nada más.
 */
export type HoverStore = {
  /** La card bajo el mouse (o la del marcador bajo el mouse). */
  getHovered: () => string | null;
  /** El marcador resaltado: el seleccionado (mobile, la card flotante) y, si no hay, el del hover. */
  getActive: () => string | null;
  setHovered: (id: string | null) => void;
  setSelected: (id: string | null) => void;
  subscribe: (onChange: () => void) => () => void;
};

export function createHoverStore(): HoverStore {
  let hovered: string | null = null;
  let selected: string | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    getHovered: () => hovered,
    getActive: () => selected ?? hovered,
    setHovered: (id) => {
      if (id === hovered) return;
      hovered = id;
      notify();
    },
    setSelected: (id) => {
      if (id === selected) return;
      selected = id;
      notify();
    },
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
  };
}

/** Fuera de /search (home, ficha): un store propio que nadie lee; el hover de la card no hace nada visible. */
export const HoverContext = createContext<HoverStore>(createHoverStore());

/** El setter del hover: es siempre el mismo, no re-renderiza a quien lo usa. */
export const useSetHovered = () => use(HoverContext).setHovered;

/** Si la card de este id es la del hover. */
export const useIsHovered = (id: string) => {
  const store = use(HoverContext);
  return useSyncExternalStore(store.subscribe, () => store.getHovered() === id, () => false);
};

/** Si el marcador de esta card está resaltado (seleccionado o en hover). */
export const useIsActiveMarker = (cardId: string) => {
  const store = use(HoverContext);
  return useSyncExternalStore(store.subscribe, () => store.getActive() === cardId, () => false);
};

/** Id del elemento de la card (para hacer scroll a ella desde el mapa). */
export const cardId = (id: string) => `place-${id}`;
