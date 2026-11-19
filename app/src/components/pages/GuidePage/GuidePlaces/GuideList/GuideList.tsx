"use client";

import { useEffect, useRef } from "react";
import type { GuidePagePlace } from "@/server/guides/page-data";
import { useGuideFocus } from "../../utils/guide-focus";
import GuideItem from "./GuideItem/GuideItem";
import styles from "./GuideList.module.scss";

// La franja de la pantalla que decide cuál está "a la vista": un poco arriba del centro. Un solo IntersectionObserver
// (sin escuchar el scroll): avisa sólo cuando un lugar entra o sale de la franja.
const ROOT_MARGIN = "-40% 0px -55% 0px";

type Props = {
  guideSlug: string;
  places: GuidePagePlace[];
};

/** La lista numerada (<ol>): marca en el store el lugar que cruza la franja del centro al scrollear. */
const GuideList = (props: Props) => {
  const ref = useRef<HTMLOListElement>(null);
  const store = useGuideFocus();

  useEffect(() => {
    const list = ref.current;
    if (!list) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Si en la misma pasada entran dos (scroll rápido), gana el último de la lista.
        const entering = entries.filter((entry) => entry.isIntersecting).map((entry) => (entry.target as HTMLElement).dataset.placeId);
        const id = entering.at(-1);
        if (id) store.setInView(id);
      },
      { rootMargin: ROOT_MARGIN },
    );
    list.querySelectorAll<HTMLElement>("[data-place-id]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [store, props.places]);

  return (
    <ol ref={ref} className={styles.list}>
      {props.places.map((place) => (
        <GuideItem key={place.id} guideSlug={props.guideSlug} place={place} />
      ))}
    </ol>
  );
};

export default GuideList;
