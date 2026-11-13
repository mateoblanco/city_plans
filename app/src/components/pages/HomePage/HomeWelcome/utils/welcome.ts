import type { PlaceListStorage } from "@/components/pages/SearchPage/utils/place-list";
import { readMyCards } from "@/components/pages/SearchPage/utils/my-cards";
import { readSaved } from "@/components/pages/SearchPage/utils/saved";

/** Marca de la bienvenida de la home ya terminada o salteada: con ella, no vuelve a aparecer. */
export const WELCOME_KEY = "cityPlans.welcome";

/** Cuántos lugares se pueden elegir en el paso 2. */
export const WELCOME_MAX_PLACES = 3;

export function browserStorage(): PlaceListStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function markWelcomeDone(storage: PlaceListStorage | null = browserStorage()) {
  try {
    storage?.setItem(WELCOME_KEY, "1");
  } catch {
    // Sin localStorage tampoco se muestra (shouldShowWelcome).
  }
}

/**
 * Si se muestra la bienvenida: sólo la primera vez (sin la marca). Quien ya tiene guardados o tarjetas (de antes de la
 * bienvenida) no la ve: se marca como hecha. Sin localStorage no se muestra (no se podría guardar nada).
 */
export function shouldShowWelcome(storage: PlaceListStorage | null): boolean {
  if (!storage) return false;
  try {
    if (storage.getItem(WELCOME_KEY) !== null) return false;
  } catch {
    return false;
  }
  const saved = readSaved(storage);
  if (saved === null) return false;
  if (saved.length > 0 || readMyCards(storage).length > 0) {
    markWelcomeDone(storage);
    return false;
  }
  return true;
}

/** Marca o desmarca un lugar del paso 2: al llegar al tope no se marcan más (se puede desmarcar). */
export function toggleChoice(selected: string[], id: string, max = WELCOME_MAX_PLACES): string[] {
  if (selected.includes(id)) return selected.filter((item) => item !== id);
  return selected.length >= max ? selected : [...selected, id];
}

/** "2 de 3". */
export const choiceCount = (selected: string[], max = WELCOME_MAX_PLACES) => `${selected.length} de ${max}`;
