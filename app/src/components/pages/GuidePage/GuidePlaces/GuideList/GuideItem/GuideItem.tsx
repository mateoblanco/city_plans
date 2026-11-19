"use client";

import Image from "next/image";
import type { GuidePagePlace } from "@/server/guides/page-data";
import OriginLink from "@/components/Tracking/OriginLink/OriginLink";
import PlaceImage from "@/components/pages/SearchPage/Results/PlaceCard/PlaceImage/PlaceImage";
import SaveButton from "@/components/pages/SearchPage/Results/PlaceCard/SaveButton/SaveButton";
import { useGuideFocus, useIsActive } from "../../../utils/guide-focus";
import { guidePlaceId } from "../../../utils/place-anchor";
import GuideStatus from "./GuideStatus/GuideStatus";
import styles from "./GuideItem.module.scss";

type Props = {
  guideSlug: string;
  place: GuidePagePlace;
};

/**
 * Un lugar de la guía: número grande, logo, nombre (link a la ficha, con origen "guide"), barrio · tipo, estado y el
 * texto de la guía; el corazón de guardar arriba a la derecha y, si la guía tiene una, la foto. Toda la card es el link
 * (el ::after del nombre), salvo el corazón. Resaltado (hover, foco o a la vista): número relleno y barra al costado,
 * no sólo un color.
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
        <span className={styles.number} aria-hidden>
          {place.number}
        </span>
        <div className={styles.body}>
          <div className={styles.top}>
            <PlaceImage name={place.name} logoUrl={place.logoUrl} logoBgColor={place.logoBgColor} size="sm" decorative />
            <div className={styles.heading}>
              <h2 className={styles.name} id={nameId}>
                <OriginLink slug={place.slug} origin="guide" row={props.guideSlug} className={styles.link}>
                  {place.name}
                </OriginLink>
              </h2>
              <p className={styles.meta}>{place.meta}</p>
              <GuideStatus status={place.status} />
            </div>
            <div className={styles.actions}>
              <SaveButton placeId={place.id} name={place.name} origin="guide" originRow={props.guideSlug} />
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
