import Link from "next/link";
import styles from "./FilterChip.module.scss";

type Props = {
  href: string;
  text: string;
  /** Activo: el chip lleva a quitar el filtro. */
  active?: boolean;
  /** La intención elegida, además de activa, es la actual del grupo. */
  current?: boolean;
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
    >
      {props.text}
    </Link>
  );
};

export default FilterChip;
