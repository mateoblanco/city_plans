"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

/** Cuánto espera después del último clic para buscar: marcar varias opciones seguidas es una sola búsqueda. */
const APPLY_DELAY_MS = 400;

const sameValues = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

/**
 * Cómo se aplica un filtro de la barra con popup (precio, dieta, descuentos): solo al dejar de elegir (APPLY_DELAY_MS),
 * con el popup abierto; cerrarlo aplica enseguida lo pendiente. Cada apertura suma una sola entrada al historial.
 * active: lo aplicado (de la URL o los chips); hrefFor: la búsqueda con esos valores.
 * options.initial: lo marcado al abrir si no es lo aplicado (Descuentos: mis tarjetas, sin aplicar hasta que se toca algo);
 * options.onApply: cada vez que se aplica una elección. touched: si en esta apertura ya se eligió algo.
 */
export function useDelayedApply(
  active: string[],
  hrefFor: (values: string[]) => string,
  options: { initial?: string[]; onApply?: (values: string[]) => void } = {},
) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(active);
  const [touched, setTouched] = useState(false);
  const [navigating, startNavigation] = useTransition();
  /** El temporizador de la búsqueda pendiente y la elección que va a aplicar. */
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; values: string[] } | null>(null);
  /** Lo último aplicado en esta apertura (arranca en lo activo), para no buscar dos veces lo mismo. */
  const applied = useRef(active);
  /** Si esta apertura ya sumó una entrada al historial: las siguientes la reemplazan. */
  const pushed = useRef(false);
  // Mientras carga la búsqueda nueva, el botón ya muestra lo elegido.
  const selected = open || navigating ? draft : active;

  useEffect(() => () => clearTimeout(pending.current?.timer), []);

  const apply = (values: string[]) => {
    if (sameValues(values, applied.current)) return;
    applied.current = values;
    const href = hrefFor(values);
    const navigate = pushed.current ? router.replace : router.push;
    pushed.current = true;
    options.onApply?.(values);
    startNavigation(() => navigate(href));
  };

  const schedule = (values: string[]) => {
    clearTimeout(pending.current?.timer);
    const timer = setTimeout(() => {
      pending.current = null;
      apply(values);
    }, APPLY_DELAY_MS);
    pending.current = { timer, values };
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      // Lo premarcado no cuenta como aplicado: cerrar sin tocar nada no busca.
      setDraft(options.initial ?? active);
      setTouched(false);
      applied.current = active;
      pushed.current = false;
      return;
    }
    // Cerrar no espera: aplica ya lo que estaba por salir.
    if (pending.current) {
      clearTimeout(pending.current.timer);
      const { values } = pending.current;
      pending.current = null;
      apply(values);
    }
  };

  /** Una elección nueva (ya ordenada): se muestra enseguida y se busca al dejar de elegir. */
  const change = (values: string[]) => {
    setDraft(values);
    setTouched(true);
    schedule(values);
  };

  return { open, selected, touched, onOpenChange, change };
}
