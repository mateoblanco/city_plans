import type { OpenStateText } from "@/server/search/labels";
import styles from "./PlaceStatus.module.scss";

type Props = {
  status: OpenStateText | null;
};

/** "Abierto Cierra 00:00": el estado con el color del tono y, sin separador, su horario (cerrado, sin él). */
const PlaceStatus = (props: Props) =>
  props.status ? (
    <span className={styles.fact}>
      <span className={styles.status} data-tone={props.status.tone}>
        {props.status.status}
      </span>
      {/* Cerrado va sin la próxima apertura ("Abre el miércoles 16:30"): la semana está en los horarios. */}
      {props.status.tone !== "closed" && props.status.detail}
    </span>
  ) : null;

export default PlaceStatus;
