import styles from "./HomeSectionsSkeleton.module.scss";

/** Mientras cargan las filas de la home: dos filas con el ancho de las cards de PlaceRow. */
const HomeSectionsSkeleton = () => (
  <div className={styles.sections} aria-busy="true">
    <span className={styles.visuallyHidden} role="status">
      Cargando lugares…
    </span>
    {Array.from({ length: 2 }, (_, row) => (
      <div key={row} className={styles.row}>
        <div className={styles.title} />
        <div className={styles.scroller}>
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className={styles.card} />
          ))}
        </div>
      </div>
    ))}
  </div>
);

export default HomeSectionsSkeleton;
