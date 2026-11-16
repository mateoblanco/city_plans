import ChipSkeletons from "../ChipSkeletons/ChipSkeletons";
import styles from "./FilterBarSkeleton.module.scss";

/**
 * La barra antes de tener los parámetros y los barrios y descuentos (el fallback de HeaderSearch, en la home y en
 * /search): los 5 filtros como píldoras, en el lugar y con el alto de la barra (sin CLS).
 */
const FilterBarSkeleton = () => {
  return (
    <div className={styles.line} aria-hidden="true">
      <ChipSkeletons kind="filters" />
    </div>
  );
};

export default FilterBarSkeleton;
