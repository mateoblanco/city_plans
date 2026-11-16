import { Suspense, type ReactNode } from "react";
import Star from "@/assets/star.svg";
import type { OpenStateText } from "@/server/search/labels";
import PlaceTags from "./PlaceTags/PlaceTags";
import styles from "./PlaceSummary.module.scss";

type Props = {
  name: string;
  /**
   * Estado de horario con los textos de la PlaceCard (placeOpenText); null si no se sabe (no se muestra). Una promesa
   * cuando depende de Google (la base no tiene horarios confirmados): la línea queda reservada hasta que llega.
   */
  status: OpenStateText | null | Promise<OpenStateText | null>;
  category: string | null;
  price: string | null;
  /** Puntaje de Google ya formateado ("4,6"), como promesa (llega con Google); null si el lugar no está en Google. */
  rating: Promise<string | null> | null;
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

/** La línea de estado y su horario: "Abierto · cierra 00:00". */
const statusFacts = (status: OpenStateText | null): Fact[] => {
  if (!status) return [];
  const facts: Fact[] = [
    {
      key: "status",
      content: (
        <span className={styles.status} data-tone={status.tone}>
          {status.status}
        </span>
      ),
    },
  ];
  if (status.detail) facts.push({ key: "detail", content: status.detail });
  return facts;
};

type GoogleStatusProps = { status: Promise<OpenStateText | null> };

/** El estado que depende de Google; sin respuesta, la línea reservada queda vacía (no sube lo de abajo). */
const GoogleStatus = async (props: GoogleStatusProps) => {
  const facts = statusFacts(await props.status);
  return facts.length > 0 ? <FactLine facts={facts} /> : <p className={styles.facts} aria-hidden />;
};

type RatingProps = { rating: Promise<string | null>; separated: boolean };

/** "· ★ 4,6 en Google", al final de la línea de categoría y precio (así aparecer no corre nada de esa línea). */
const Rating = async (props: RatingProps) => {
  const rating = await props.rating;
  if (!rating) return null;
  return (
    <span className={styles.fact}>
      {props.separated && <span className={styles.separator} aria-hidden>·</span>}
      <Star className={styles.star} aria-hidden width={14} height={13} /> {rating} en Google
    </span>
  );
};

/**
 * Lugar del puntaje mientras llega Google: el mismo texto invisible, así la línea ya tiene su ancho y no cambia de
 * corte al llegar.
 */
const RatingReserve = (props: { separated: boolean }) => (
  <span className={`${styles.fact} ${styles.reserve}`} aria-hidden>
    {props.separated && <span className={styles.separator}>·</span>}
    <Star className={styles.star} width={14} height={13} /> 4,6 en Google
  </span>
);

/**
 * Nombre, la línea de estado y horario, la de categoría · precio · puntaje, la descripción y los chips. Lo de la base
 * sale enseguida; el puntaje (y el estado, si la base no tiene horarios confirmados) llega de Google en su Suspense,
 * con el lugar ya reservado.
 */
const PlaceSummary = (props: Props) => {
  const description = props.description?.trim();

  // Dos líneas: arriba el estado y su horario; abajo categoría · precio · puntaje. Dentro de cada una, " · ".
  const pendingStatus = props.status instanceof Promise ? props.status : null;
  const hours = pendingStatus ? [] : statusFacts(props.status as OpenStateText | null);

  const details: Fact[] = [];
  if (props.category) details.push({ key: "category", content: props.category });
  if (props.price) details.push({ key: "price", content: props.price });
  const separated = details.length > 0;

  const statusLine = pendingStatus ? (
    <Suspense fallback={<p className={styles.facts} aria-hidden />}>
      <GoogleStatus status={pendingStatus} />
    </Suspense>
  ) : (
    <FactLine facts={hours} />
  );

  const detailsLine =
    details.length > 0 || props.rating ? (
      <p className={styles.facts}>
        {details.map((fact, index) => (
          <span key={fact.key} className={styles.fact}>
            {index > 0 && <span className={styles.separator} aria-hidden>·</span>}
            {fact.content}
          </span>
        ))}
        {props.rating && (
          <Suspense fallback={<RatingReserve separated={separated} />}>
            <Rating rating={props.rating} separated={separated} />
          </Suspense>
        )}
      </p>
    ) : null;

  return (
    <div className={styles.summary}>
      <div className={styles.main}>
        <h1 className={styles.name}>{props.name}</h1>

        {(pendingStatus || hours.length > 0 || detailsLine) && (
          <div className={styles.factLines}>
            {statusLine}
            {detailsLine}
          </div>
        )}
      </div>

      {description && <p className={styles.description}>{description}</p>}

      <PlaceTags chips={props.chips} />
    </div>
  );
};

export default PlaceSummary;
