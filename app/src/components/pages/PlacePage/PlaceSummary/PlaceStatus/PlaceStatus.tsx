import type { OpenStateText } from "@/server/search/labels";
import styles from "./PlaceStatus.module.scss";

type Props = {
  status: OpenStateText | null;
};

/** "● Abierto Cierra 00:00": el punto y el estado con el color del tono y su horario (cerrado, sin él). */
const PlaceStatus = (props: Props) => {
  // Cerrado va sin la próxima apertura ("Abre el miércoles 16:30"): la semana está en los horarios.
  const detail = props.status && props.status.tone !== "closed" ? props.status.detail : null;
  return props.status ? (
    <span className={styles.fact}>
      <span className={styles.status} data-tone={props.status.tone}>
        <span className={styles.dot} aria-hidden />
        {props.status.status}
      </span>
      {detail}
    </span>
  ) : null;
};

export default PlaceStatus;
