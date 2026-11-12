import { resultsAnnouncement, type NearbyCount } from "../../utils/results-count";
import styles from "./ResultsAnnouncer.module.scss";

type Props = {
  /** Entre búsquedas (o antes de la primera): "Buscando…". */
  pending: boolean;
  count: number;
  /** "Cerca de <barrio>": "18 lugares en Palermo · 6 cerca". */
  nearby: NearbyCount | null;
  /** Sube con cada búsqueda nueva (no con el scroll infinito): ver la key de abajo. */
  fitKey: number;
  /** Mientras busca, otro texto que "Buscando…" ("Buscando cerca tuyo…"). */
  pendingLabel?: string;
};

/**
 * Región viva de /search, visualmente oculta (en mobile también: el título del panel no es una región viva, así que no
 * se anuncia dos veces). Vive en MapSync, fuera del Suspense con key de la búsqueda, así no se vuelve a crear con cada
 * búsqueda: dice "Buscando…" y después "N lugares". La key del span es la búsqueda: si la nueva trae la misma cantidad,
 * el texto se vuelve a insertar y se anuncia igual; con "Ver más" (misma búsqueda) no cambia nada y no se anuncia.
 */
const ResultsAnnouncer = (props: Props) => (
  <p className={styles.announcer} role="status" aria-live="polite">
    <span key={props.fitKey}>{resultsAnnouncement(props.pending ? null : props.count, props.nearby, props.pendingLabel)}</span>
  </p>
);

export default ResultsAnnouncer;
