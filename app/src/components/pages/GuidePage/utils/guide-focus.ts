"use client";

import { createContext, use, useSyncExternalStore } from "react";

/**
 * El lugar resaltado de la guía, compartido entre la lista y el mapa: el del hover o foco (lista o pin) y, si no hay,
 * el que está a la vista al scrollear (IntersectionObserver de GuideList). Store externo y estable, como el hover de
 * /search (SearchPage/utils/hover.ts): cada item y cada pin se suscriben sólo a si son el suyo, así un cambio
 * re-renderiza el que entra y el que sale, nada más.
 */
export type GuideFocusStore = {
  getActive: () => string | null;
  setHovered: (id: string | null) => void;
  setInView: (id: string | null) => void;
  subscribe: (onChange: () => void) => () => void;
};

export function createGuideFocusStore(): GuideFocusStore {
  let hovered: string | null = null;
  let inView: string | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    getActive: () => hovered ?? inView,
    setHovered: (id) => {
      if (id === hovered) return;
      hovered = id;
      notify();
    },
    setInView: (id) => {
      if (id === inView) return;
      inView = id;
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

export const GuideFocusContext = createContext<GuideFocusStore>(createGuideFocusStore());

export const useGuideFocus = () => use(GuideFocusContext);

/** Si este lugar es el resaltado. En el servidor y al hidratar, ninguno. */
export const useIsActive = (id: string) => {
  const store = use(GuideFocusContext);
  return useSyncExternalStore(store.subscribe, () => store.getActive() === id, () => false);
};
