"use client";

import Select from "@/components/base/Select/Select";
import type { ChipRef } from "@/components/pages/SearchPage/utils/search-href";
import { useDelayedApply } from "../utils/use-delayed-apply";

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

/**
 * Select de un filtro de la barra (precio, dieta): "Cualquier…" o varias opciones. Se aplica como el de barrios: solo al
 * dejar de elegir, con el popup abierto; cerrarlo aplica enseguida lo pendiente (useDelayedApply). Cada apertura suma una
 * sola entrada al historial.
 */
const FilterSelect = (props: Props) => {
  // En el orden de las opciones, no en el de los chips.
  const active = props.options.map((option) => option.id).filter((id) => props.chips.some((chip) => chip.id === id));
  const { open, selected, onOpenChange, change } = useDelayedApply(active, (values) => props.hrefFor(values, props.chips));
  const labels = new Map(props.options.map((option): [string, string] => [option.id, option.label]));
  const items = [{ value: "", label: props.anyLabel }, ...props.options.map((option) => ({ value: option.id, label: option.label }))];

  // "Cualquier…" ("") va marcado con la elección vacía y la vacía al elegirlo.
  const value = selected.length ? selected : [""];
  const onValueChange = (next: string[]) => {
    // Contra lo que muestra el select (con "Cualquier…" marcado es [""]), no contra la elección.
    const added = next.find((item) => !value.includes(item));
    const chosen = added === "" ? [] : next.filter((item) => item !== "");
    const normalized = props.normalize ? props.normalize(chosen, added) : chosen;
    // En el orden de las opciones, así el botón dice "Bajo y Alto" sin importar el orden de los clics.
    change(props.options.map((option) => option.id).filter((id) => normalized.includes(id)));
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
