"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { isBot } from "@/lib/bots";
import type { GuidePagePlace } from "@/server/guides/page-data";
import { createGuideFocusStore, GuideFocusContext } from "../utils/guide-focus";
import type { GuidePin } from "../utils/pins";
import GuideList from "./GuideList/GuideList";
import GuideMapColumn from "./GuideMapColumn/GuideMapColumn";
import GuideMapDialog from "./GuideMapDialog/GuideMapDialog";
import styles from "./GuidePlaces.module.scss";

const noSubscribe = () => () => {};

/**
 * Si este navegador puede tener mapa: nunca un bot (isBot por user agent, la misma regla de los eventos). Se decide en
 * el cliente porque la página es la misma para todos (cacheada); en el servidor y al hidratar, false.
 */
const useCanMap = () => useSyncExternalStore(noSubscribe, () => !isBot(navigator.userAgent), () => false);

type Props = {
  guideSlug: string;
  places: GuidePagePlace[];
  /** El encabezado de la guía (server): va arriba de la lista, en la misma columna. */
  header: ReactNode;
};

/** La lista y el mapa con el resaltado compartido (GuideFocusContext). */
const GuidePlaces = (props: Props) => {
  const [store] = useState(createGuideFocusStore);
  const canMap = useCanMap();
  const pins: GuidePin[] = props.places.map((place) => ({ id: place.id, number: place.number, name: place.name, lat: place.lat, lng: place.lng }));

  return (
    <GuideFocusContext value={store}>
      <div className={styles.layout}>
        <div className={styles.main}>
          {props.header}
          <GuideList guideSlug={props.guideSlug} places={props.places} />
        </div>
        <GuideMapColumn pins={pins} enabled={canMap} />
      </div>
      {canMap && pins.length > 0 && <GuideMapDialog pins={pins} />}
    </GuideFocusContext>
  );
};

export default GuidePlaces;
