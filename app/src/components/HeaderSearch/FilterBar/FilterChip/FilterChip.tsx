import Link from "next/link";
import type { FilterKey } from "@/lib/product-analytics/events";
import { trackAttrs } from "@/lib/product-analytics/track";
import styles from "./FilterChip.module.scss";

type Props = {
  href: string;
  text: string;
  /** Activo: el chip lleva a quitar el filtro. */
  active?: boolean;
  /** La intención elegida, además de activa, es la actual del grupo. */
  current?: boolean;
  /**
   * Para la analítica: el filtro y su id. Activo, tocarlo lo quita (chip_removed, con si lo había puesto el texto); si
   * no, lo agrega (filter_changed).
   */
  analytics?: { filter: FilterKey; id: string; fromText?: boolean };
};

/** Filtro de la barra: un link que agrega el filtro o, si está activo, lo quita. */
const FilterChip = (props: Props) => {
  return (
    <Link
      className={styles.chip}
      data-active={props.active || undefined}
      aria-current={props.current ? "true" : undefined}
      aria-label={props.active ? `Quitar filtro: ${props.text}` : undefined}
      href={props.href}
      {...(props.analytics &&
        (props.active
          ? trackAttrs("chip_removed", { filter: props.analytics.filter, chip: props.analytics.id, from_text: props.analytics.fromText ?? false })
          : trackAttrs("filter_changed", { filter: props.analytics.filter, value: props.analytics.id })))}
    >
      {props.text}
    </Link>
  );
};

export default FilterChip;
