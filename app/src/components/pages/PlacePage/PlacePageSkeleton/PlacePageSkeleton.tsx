import pageStyles from "../PlacePage.module.scss";
import styles from "./PlacePageSkeleton.module.scss";

/** Mientras carga la ficha: el mismo layout que PlacePage (header sin barra, columna principal y lateral). */
const PlacePageSkeleton = () => (
  <div className={pageStyles.page} aria-busy="true">
    <span className={styles.visuallyHidden} role="status">
      Cargando lugar…
    </span>

    <div className={styles.header}>
      <div className={pageStyles.content}>
        <div className={styles.back} />
      </div>
      <div className={pageStyles.content}>
        <div className={styles.row}>
          <div className={styles.logo} />
          <div className={styles.actions}>
            <div className={styles.action} />
            <div className={styles.action} />
          </div>
        </div>
      </div>
    </div>

    <div className={pageStyles.content}>
      <div className={pageStyles.columns}>
        <div className={pageStyles.main}>
          <div className={styles.summary}>
            <div className={styles.name} />
            <div className={styles.facts} />
            <div className={styles.description}>
              <div className={styles.line} />
              <div className={styles.line} />
              <div className={styles.lineShort} />
            </div>
            <div className={styles.chips}>
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className={styles.chip} />
              ))}
            </div>
          </div>

          <div className={pageStyles.location}>
            <div className={styles.map} />
            <div className={styles.location}>
              <div className={styles.line} />
              <div className={styles.lineShort} />
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle} />
            <div className={styles.cards}>
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className={styles.card} />
              ))}
            </div>
          </div>
        </div>

        <aside className={pageStyles.side}>
          <div className={styles.infoCard} />
        </aside>
      </div>
    </div>
  </div>
);

export default PlacePageSkeleton;
