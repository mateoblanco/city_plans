"use client";

import PlaceImage from "@/components/pages/SearchPage/Results/PlaceCard/PlaceImage/PlaceImage";
import type { WelcomePlace } from "@/server/welcome";
import styles from "./WelcomePlaceCard.module.scss";

type Props = {
  place: WelcomePlace;
  checked: boolean;
  /** Ya hay 3 marcados: éste no se puede marcar. */
  disabled: boolean;
  onToggle: () => void;
};

/**
 * Card compacta de la bienvenida: logo, nombre y tipo (la categoría principal). Es un checkbox (toda la card es su
 * label), sin link a la ficha.
 */
const WelcomePlaceCard = (props: Props) => (
  <label className={styles.card} data-checked={props.checked ? "" : undefined} data-disabled={props.disabled ? "" : undefined}>
    <input type="checkbox" className={styles.input} checked={props.checked} disabled={props.disabled} onChange={props.onToggle} />
    <PlaceImage name={props.place.name} logoUrl={props.place.logoUrl} logoBgColor={props.place.logoBgColor} size="sm" />
    <span className={styles.text}>
      <span className={styles.name}>{props.place.name}</span>
      {props.place.type && <span className={styles.type}>{props.place.type}</span>}
    </span>
    <span className={styles.check} aria-hidden="true">
      <svg viewBox="0 0 16 16" width="12" height="12">
        <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  </label>
);

export default WelcomePlaceCard;
