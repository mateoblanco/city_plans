"use client";

import Image from "next/image";
import type { GuidePagePlace } from "@/server/guides/page-data";
import OriginLink from "@/components/Tracking/OriginLink/OriginLink";
import PlaceImage from "@/components/pages/SearchPage/Results/PlaceCard/PlaceImage/PlaceImage";
import SaveButton from "@/components/pages/SearchPage/Results/PlaceCard/SaveButton/SaveButton";
import { useGuideFocus, useIsActive } from "../../../utils/guide-focus";
import { guidePlaceId } from "../../../utils/place-anchor";
import styles from "./GuideItem.module.scss";
import { track } from "@/lib/product-analytics/track";

type Props = {
  guideSlug: string;
  place: GuidePagePlace;
};

/**
 * Un lugar de la guía: el logo y debajo el número y el nombre (link a la ficha, con origen "guide") y barrio · tipo, y el texto de
 * la guía; el corazón de guardar arriba a la derecha y, si la guía tiene una, la foto. Toda la card es el link (el
 * ::after del nombre), salvo el corazón. Resaltado (hover, foco o a la vista): el borde. El número va antes del nombre
 * ("1. Escaramuza", como en los pines del mapa) y es aria-hidden: la lista ya anuncia la posición.
 */
const GuideItem = (props: Props) => {
  const place = props.place;
  const store = useGuideFocus();
  const active = useIsActive(place.id);
  const nameId = `${guidePlaceId(place.id)}-name`;

  return (
    <li className={styles.item}>
      <article
        id={guidePlaceId(place.id)}
        className={styles.card}
        data-place-id={place.id}
        data-active={active || undefined}
        // Destino del foco desde un pin del mapa (no es un control: sin Tab).
        tabIndex={-1}
        aria-labelledby={nameId}
        onMouseEnter={() => store.setHovered(place.id)}
        onMouseLeave={() => store.setHovered(null)}
        onFocus={() => store.setHovered(place.id)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) store.setHovered(null);
        }}
      >
        <div className={styles.body}>
          <div className={styles.top}>
            <div className={styles.heading}>
              <PlaceImage name={place.name} logoUrl={place.logoUrl} logoBgColor={place.logoBgColor} size="sm" decorative />
              <div className={styles.titles}>
                <h2 className={styles.name} id={nameId}>
                  <span className={styles.number} aria-hidden>
                    {place.number}.{" "}
                  </span>
                  <OriginLink
                    slug={place.slug}
                    origin="guide"
                    row={props.guideSlug}
                    className={styles.link}
                    onOpen={() =>
                      track("guide_place_clicked", { place_id: place.id, slug: place.slug, guide: props.guideSlug, position: place.number })
                    }
                  >
                    {place.name}
                  </OriginLink>
                </h2>
                <p className={styles.meta}>{place.meta}</p>
              </div>
            </div>
            <div className={styles.actions}>
              <SaveButton placeId={place.id} slug={place.slug} name={place.name} origin="guide" originRow={props.guideSlug} touchTarget />
            </div>
          </div>
          {place.photo && (
            <Image
              className={styles.photo}
              src={place.photo.src}
              alt={place.photo.alt}
              width={place.photo.width}
              height={place.photo.height}
              sizes="(min-width: 768px) 560px, 100vw"
            />
          )}
          <p className={styles.text}>{place.text}</p>
        </div>
      </article>
    </li>
  );
};

export default GuideItem;
