import type { ReactNode } from "react";
import Star from "@/assets/star.svg";
import type { OpenStateText } from "@/server/search/labels";
import PlaceTags from "./PlaceTags/PlaceTags";
import styles from "./PlaceSummary.module.scss";

type Props = {
  name: string;
  /** Estado de horario con los textos de la PlaceCard (placeOpenText); null si no se sabe (no se muestra). */
  status: OpenStateText | null;
  category: string | null;
  price: string | null;
  /** Puntaje de Google ya formateado ("4,6"); null sin puntaje. */
  rating: string | null;
  description: string | null;
  /** Chips de dietas y tags (placeChips). */
  chips: string[];
  instagram: string | null;
};

type Fact = { key: string; content: ReactNode };

/** Una línea de datos separados por " · "; nada si está vacía. */
const FactLine = ({ facts }: { facts: Fact[] }) =>
  facts.length > 0 ? (
    <p className={styles.facts}>
      {facts.map((fact, index) => (
        <span key={fact.key} className={styles.fact}>
          {index > 0 && <span className={styles.separator} aria-hidden>·</span>}
          {fact.content}
        </span>
      ))}
    </p>
  ) : null;

/** Nombre, la línea de estado y horario, la de categoría · precio · puntaje, la descripción, los chips y el Instagram. */
const PlaceSummary = (props: Props) => {
  const description = props.description?.trim();

  // Dos líneas: arriba el estado y su horario; abajo categoría · precio · puntaje. Dentro de cada una, " · ".
  const hours: Fact[] = [];
  if (props.status) {
    hours.push({
      key: "status",
      content: (
        <span className={styles.status} data-tone={props.status.tone}>
          {props.status.status}
        </span>
      ),
    });
    if (props.status.detail) hours.push({ key: "detail", content: props.status.detail });
  }

  const details: Fact[] = [];
  if (props.category) details.push({ key: "category", content: props.category });
  if (props.price) details.push({ key: "price", content: props.price });
  if (props.rating) {
    details.push({
      key: "rating",
      content: (
        <>
          <Star className={styles.star} aria-hidden width={14} height={13} /> {props.rating} en Google
        </>
      ),
    });
  }

  return (
    <div className={styles.summary}>
      <div className={styles.main}>
        <h1 className={styles.name}>{props.name}</h1>

        {(hours.length > 0 || details.length > 0) && (
          <div className={styles.factLines}>
            <FactLine facts={hours} />
            <FactLine facts={details} />
          </div>
        )}
      </div>

      {description && <p className={styles.description}>{description}</p>}

      <PlaceTags chips={props.chips} />

     
    </div>
  );
};

export default PlaceSummary;
