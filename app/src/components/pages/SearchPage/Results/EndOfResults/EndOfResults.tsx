import styles from "./EndOfResults.module.scss";

/** El final de la lista, cuando no quedan cards por sumar: cómo seguir buscando. */
const EndOfResults = () => (
  <div className={styles.end}>
    <p className={styles.title}>No hay más resultados</p>
    <p className={styles.hint}>Probá sacar algún filtro o hacé otra búsqueda.</p>
  </div>
);

export default EndOfResults;
