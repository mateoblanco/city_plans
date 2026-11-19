import styles from "./GuideMarker.module.scss";

type Props = {
  number: number;
  active: boolean;
};

/**
 * Pin numerado de la guía: el mismo número que la lista. Resaltado: relleno, más grande y con anillo (no sólo color).
 * El nombre accesible es el title del marcador.
 */
const GuideMarker = (props: Props) => (
  <div className={styles.marker} data-active={props.active || undefined} aria-hidden>
    {props.number}
  </div>
);

export default GuideMarker;
