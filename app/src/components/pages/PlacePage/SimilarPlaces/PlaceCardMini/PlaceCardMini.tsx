import { memo } from "react";
import Link from "next/link";
import { label } from "@shared/tags.ts";
import type { SearchResult } from "@/server/search";
import PlaceImage from "@/components/pages/SearchPage/Results/PlaceCard/PlaceImage/PlaceImage";
import CardDiscounts from "@/components/pages/SearchPage/Results/PlaceCard/CardDiscounts/CardDiscounts";
import styles from "./PlaceCardMini.module.scss";

type Props = {
  place: SearchResult;
};

/** Card chica de "Lugares similares": logo, nombre, barrio y tipo, y descuentos. Sin horario, sin guardar y sin hover con el mapa. */
const PlaceCardMini = (props: Props) => (
  <article className={styles.card}>
    <PlaceImage name={props.place.name} logoUrl={props.place.logoUrl} logoBgColor={props.place.logoBgColor} size="sm" />

    <div className={styles.body}>
      {/* El ::after del link cubre toda la card. */}
      <h3 className={styles.name}>
        <Link href={`/place/${props.place.slug}`} className={styles.link}>{props.place.name}</Link>
      </h3>

      <p className={styles.meta}>
        {[props.place.neighborhood, ...props.place.categories.map((id) => label(id, "es"))].filter(Boolean).join(" · ")}
      </p>

      <CardDiscounts providers={props.place.discounts} />
    </div>
  </article>
);

export default memo(PlaceCardMini);
