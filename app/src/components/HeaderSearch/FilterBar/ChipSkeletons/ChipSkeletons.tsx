import styles from "./ChipSkeletons.module.scss";

type Props = {
  /** "filters": los 5 filtros de la barra (Dónde, Precio, Dieta, Descuentos, Abierto ahora); "subs": sub-filtros. */
  kind: "filters" | "subs";
};

const COUNT = { filters: 5, subs: 3 };

/**
 * Píldoras grises del alto y, más o menos, el ancho de los chips de la barra, mientras no se sabe qué va. Sueltas (sin
 * caja propia): son parte de la línea de la barra. Sólo visuales.
 */
const ChipSkeletons = (props: Props) => {
  return Array.from({ length: COUNT[props.kind] }, (_, index) => <span key={index} className={styles.pill} data-kind={props.kind} aria-hidden="true" />);
};

export default ChipSkeletons;
