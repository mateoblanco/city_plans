"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import Select from "@/components/base/Select/Select";
import { setPricesHref, type ChipRef, type SearchUrl } from "@/components/pages/SearchPage/utils/search-href";

const ANY = "Cualquier precio";
const EMPTY_LABEL = "Precio";
/** Cuánto espera después del último clic para buscar: marcar varios niveles seguidos es una sola búsqueda. */
const APPLY_DELAY_MS = 400;

type Props = {
  options: { id: string; label: string }[];
  /** Los chips de precio de la búsqueda (del texto o de la barra): los activos y cómo se apagan. */
  chips: ChipRef[];
  state: SearchUrl;
};

const sameValues = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

/**
 * Precio: "Cualquier precio" o varios niveles. Se aplica como el de barrios: solo al dejar de elegir (APPLY_DELAY_MS),
 * con el popup abierto; cerrarlo aplica enseguida lo pendiente. Cada apertura suma una sola entrada al historial.
 */
const PriceSelect = (props: Props) => {
  const router = useRouter();
  // En el orden de las opciones, no en el de los chips.
  const active = props.options.map((option) => option.id).filter((id) => props.chips.some((chip) => chip.id === id));
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(active);
  const [navigating, startNavigation] = useTransition();
  /** El temporizador de la búsqueda pendiente y la elección que va a aplicar. */
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; values: string[] } | null>(null);
  /** Lo último aplicado en esta apertura (arranca en lo activo), para no buscar dos veces lo mismo. */
  const applied = useRef(active);
  /** Si esta apertura ya sumó una entrada al historial: las siguientes la reemplazan. */
  const pushed = useRef(false);
  // Mientras carga la búsqueda nueva, el botón ya muestra lo elegido.
  const selected = open || navigating ? draft : active;
  const labels = new Map(props.options.map((option): [string, string] => [option.id, option.label]));
  const items = [{ value: "", label: ANY }, ...props.options.map((option) => ({ value: option.id, label: option.label }))];

  useEffect(() => () => clearTimeout(pending.current?.timer), []);

  const apply = (values: string[]) => {
    if (sameValues(values, applied.current)) return;
    applied.current = values;
    const href = setPricesHref(props.state, values, props.chips);
    const navigate = pushed.current ? router.replace : router.push;
    pushed.current = true;
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
      setDraft(active);
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

  // "Cualquier precio" ("") va marcado con la elección vacía y la vacía al elegirlo.
  const value = selected.length ? selected : [""];
  const onValueChange = (next: string[]) => {
    // Contra lo que muestra el select (con "Cualquier precio" marcado es [""]), no contra la elección.
    const added = next.find((item) => !value.includes(item));
    const chosen = added === "" ? [] : next.filter((item) => item !== "");
    // En el orden de las opciones, así el botón dice "Bajo y Alto" sin importar el orden de los clics.
    const values = props.options.map((option) => option.id).filter((id) => chosen.includes(id));
    setDraft(values);
    schedule(values);
  };

  const triggerLabel = () => {
    const names = selected.map((id) => labels.get(id) ?? id);
    if (names.length === 0) return EMPTY_LABEL;
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} y ${names[1]}`;
    return `${names[0]} +${names.length - 1}`;
  };

  return (
    // "Cualquier precio" arriba, separado de los niveles.
    <Select
      label="Precio"
      items={items}
      value={value}
      onValueChange={onValueChange}
      open={open}
      onOpenChange={onOpenChange}
      triggerLabel={triggerLabel}
      active={selected.length > 0}
      separatorAfter=""
    />
  );
};

export default PriceSelect;
