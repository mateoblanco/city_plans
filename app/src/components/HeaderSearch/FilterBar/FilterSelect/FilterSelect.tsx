"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import Select from "@/components/base/Select/Select";
import type { ChipRef } from "@/components/pages/SearchPage/utils/search-href";

/** Cuánto espera después del último clic para buscar: marcar varias opciones seguidas es una sola búsqueda. */
const APPLY_DELAY_MS = 400;

type Props = {
  /** Nombre accesible del botón. */
  label: string;
  /** Texto del botón sin nada elegido ("Precio"). */
  emptyLabel: string;
  /** Primera opción, que limpia la elección ("Cualquier precio"). */
  anyLabel: string;
  options: { id: string; label: string }[];
  /** Los chips de este filtro (del texto o de la barra): los activos y cómo se apagan. */
  chips: ChipRef[];
  /** URL de la búsqueda con estos valores elegidos (los chips sirven para quitar los del texto no elegidos). */
  hrefFor: (values: string[], chips: ChipRef[]) => string;
  /** Ajusta la elección después de un clic (added: lo recién marcado), p. ej. opciones que se excluyen. */
  normalize?: (values: string[], added: string | undefined) => string[];
};

const sameValues = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

/**
 * Select de un filtro de la barra (precio, dieta): "Cualquier…" o varias opciones. Se aplica como el de barrios: solo al
 * dejar de elegir (APPLY_DELAY_MS), con el popup abierto; cerrarlo aplica enseguida lo pendiente. Cada apertura suma una
 * sola entrada al historial.
 */
const FilterSelect = (props: Props) => {
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
  const items = [{ value: "", label: props.anyLabel }, ...props.options.map((option) => ({ value: option.id, label: option.label }))];

  useEffect(() => () => clearTimeout(pending.current?.timer), []);

  const apply = (values: string[]) => {
    if (sameValues(values, applied.current)) return;
    applied.current = values;
    const href = props.hrefFor(values, props.chips);
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

  // "Cualquier…" ("") va marcado con la elección vacía y la vacía al elegirlo.
  const value = selected.length ? selected : [""];
  const onValueChange = (next: string[]) => {
    // Contra lo que muestra el select (con "Cualquier…" marcado es [""]), no contra la elección.
    const added = next.find((item) => !value.includes(item));
    const chosen = added === "" ? [] : next.filter((item) => item !== "");
    const normalized = props.normalize ? props.normalize(chosen, added) : chosen;
    // En el orden de las opciones, así el botón dice "Bajo y Alto" sin importar el orden de los clics.
    const values = props.options.map((option) => option.id).filter((id) => normalized.includes(id));
    setDraft(values);
    schedule(values);
  };

  const triggerLabel = () => {
    const names = selected.map((id) => labels.get(id) ?? id);
    if (names.length === 0) return props.emptyLabel;
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} y ${names[1]}`;
    return `${names[0]} +${names.length - 1}`;
  };

  return (
    // "Cualquier…" arriba, separado de las opciones.
    <Select
      label={props.label}
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

export default FilterSelect;
