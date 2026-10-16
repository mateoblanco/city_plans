import MapColumn from "../Map/MapColumn/MapColumn";
import styles from "./ResultsSkeleton.module.scss";

const ResultsSkeleton = () => {
  return (
    <div className={styles.results} aria-busy="true">
      <span className={styles.visuallyHidden} role="status">
        Buscando…
      </span>
      <div className={styles.grid}>
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className={styles.skeletonCard} />
        ))}
      </div>
      <MapColumn />
    </div>
  );
};

export default ResultsSkeleton;
