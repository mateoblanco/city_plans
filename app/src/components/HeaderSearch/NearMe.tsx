"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { nearHref, type SearchUrl } from "@/components/pages/SearchPage/utils/search-href";
import styles from "./HeaderSearch.module.scss";

/** El pedido automático (cuando el texto dice "cerca mío") se hace una sola vez por sesión. */
const AUTO_ASKED_KEY = "salimos:near-auto-asked";

const firstAutoAsk = () => {
  try {
    if (sessionStorage.getItem(AUTO_ASKED_KEY)) return false;
    sessionStorage.setItem(AUTO_ASKED_KEY, "1");
    return true;
  } catch {
    // Sin storage no hay forma de recordar que ya se pidió: mejor no pedir solo.
    return false;
  }
};

type Props = {
  state: SearchUrl;
  /** Ya se está buscando con ubicación. */
  active: boolean;
  /** URL sin la ubicación. */
  offHref: string;
  /** La búsqueda pidió ubicación (needsLocation) y no hay: pedirla sola, una vez. */
  auto: boolean;
};

const NearMe = (props: Props) => {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  // El estado sólo cambia en los callbacks del navegador, nunca de forma sincrónica.
  const locate = (navigate: (href: string) => void) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => navigate(nearHref(props.state, coords.latitude, coords.longitude)),
      () => setFailed(true),
      { timeout: 10000, maximumAge: 5 * 60 * 1000 },
    );
  };

  const onClick = () => {
    if ("geolocation" in navigator) locate((href) => router.push(href));
    else setFailed(true);
  };

  useEffect(() => {
    // replace: volver atrás no tiene que caer en la página que pide la ubicación.
    if (props.auto && !props.active && "geolocation" in navigator && firstAutoAsk()) locate((href) => router.replace(href));
    // Sólo al montar: cada búsqueda nueva monta el componente de nuevo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {props.active ? (
        <Link className={styles.filter} data-active href={props.offHref} aria-label="Quitar filtro: cerca mío">
          Cerca mío ×
        </Link>
      ) : (
        <button type="button" className={styles.filter} onClick={onClick}>
          Cerca mío
        </button>
      )}
      {failed && (
        <p className={styles.notice} role="status">
          No pudimos obtener tu ubicación.
        </p>
      )}
    </>
  );
};

export default NearMe;
