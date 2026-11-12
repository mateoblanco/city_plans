import styles from "./ResultsSkeleton.module.scss";

type Props = {
  /** Texto visible arriba de las cards ("Buscando cerca tuyo…"); sin él, "Buscando…" sólo para lectores de pantalla. */
  label?: string;
};

/** Las cards mientras busca. El mapa no: es el de MapSync, que queda montado (con los puntos anteriores) entre búsquedas. */
const ResultsSkeleton = (props: Props) => {
  return (
    <div className={styles.results} aria-busy="true">
      {props.label ? <p className={styles.label}>{props.label}</p> : <span className={styles.visuallyHidden}>Buscando…</span>}
      <div className={styles.grid}>
        {Array.from({ length: 12 }, (_, index) => (
          <div key={index} className={styles.skeletonCard} />
        ))}
      </div>
    </div>
  );
};

export default ResultsSkeleton;
