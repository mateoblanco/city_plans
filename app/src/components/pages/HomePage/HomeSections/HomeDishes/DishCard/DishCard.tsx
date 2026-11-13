import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import type { ImageLoad } from "@/components/pages/SearchPage/utils/eager-images";
import styles from "./DishCard.module.scss";

type Props = {
  href: string;
  text: string;
  /** Cuadrada (import estático: el ancho y alto reservan el lugar, sin CLS). */
  image: StaticImageData;
  /** Visible al cargar: se pide ya; sin load, lazy. */
  load?: ImageLoad;
};

/** Card de un plato: la foto cuadrada con el nombre debajo; toda la card es el link. La foto es decorativa (alt vacío). */
const DishCard = (props: Props) => (
  <Link className={styles.card} href={props.href}>
    <span className={styles.frame}>
      <Image
        className={styles.image}
        src={props.image}
        alt=""
        // 88px en mobile, 112px desde md (los mismos que el CSS).
        sizes="(min-width: 768px) 112px, 88px"
        loading={props.load ? "eager" : "lazy"}
        fetchPriority={props.load === "high" ? "high" : undefined}
      />
    </span>
    <span className={styles.text}>{props.text}</span>
  </Link>
);

export default DishCard;
