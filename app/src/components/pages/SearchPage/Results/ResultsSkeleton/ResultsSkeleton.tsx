import styles from "./ResultsSkeleton.module.scss";

/** Las cards mientras busca. El mapa no: es el de MapSync, que queda montado (con los puntos anteriores) entre búsquedas. */
const ResultsSkeleton = () => {
  return (
    <div className={styles.results} aria-busy="true">
      <span className={styles.visuallyHidden} role="status">
        Buscando…
      </span>
      <div className={styles.grid}>
        {Array.from({ length: 12 }, (_, index) => (
          <div key={index} className={styles.skeletonCard} />
        ))}
      </div>
    </div>
  );
};

export default ResultsSkeleton;
