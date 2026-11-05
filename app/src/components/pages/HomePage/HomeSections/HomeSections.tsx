import { cookies } from "next/headers";
import { homeRows, type HomeRow } from "@/server/home";
import { LIKES_COOKIE, parseLikesCookie } from "@/components/pages/SearchPage/utils/likes-cookie";
import PlaceRow from "./PlaceRow/PlaceRow";
import styles from "./HomeSections.module.scss";

/**
 * Filas de la home debajo del buscador: "Para vos" (con los likes de la cookie, si hay perfil) y las del config, que
 * vienen de la caché. Si falla, la home queda sin filas.
 */
const HomeSections = async () => {
  const likes = parseLikesCookie((await cookies()).get(LIKES_COOKIE)?.value);
  let rows: HomeRow[];
  try {
    rows = await homeRows(likes);
  } catch (error) {
    console.error("Fallaron las secciones de la home", error);
    return null;
  }
  if (rows.length === 0) return null;

  return (
    <div className={styles.sections}>
      {rows.map((row) => (
        <PlaceRow key={row.id} title={row.title} places={row.places} href={row.href} />
      ))}
    </div>
  );
};

export default HomeSections;
