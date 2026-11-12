import { cookies } from "next/headers";
import { homeRows, type HomeRow } from "@/server/home";
import { SAVED_COOKIE, parseSavedCookie } from "@/components/pages/SearchPage/utils/saved-cookie";
import { EAGER_HOME_CARDS } from "@/components/pages/SearchPage/utils/eager-images";
import PlaceRow from "./PlaceRow/PlaceRow";
import styles from "./HomeSections.module.scss";

/**
 * Filas de la home debajo del buscador: "Guardados" y "Para vos" salen de la misma cookie de guardados ("Guardados"
 * con todos, "Para vos" si arman perfil) y las del config, que vienen de la caché. Si falla, la home queda sin filas.
 */
const HomeSections = async () => {
  const jar = await cookies();
  const saved = parseSavedCookie(jar.get(SAVED_COOKIE)?.value);
  let rows: HomeRow[];
  try {
    rows = await homeRows(saved);
  } catch (error) {
    console.error("Fallaron las secciones de la home", error);
    return null;
  }
  if (rows.length === 0) return null;

  return (
    <div className={styles.sections}>
      {rows.map((row, index) => (
        <PlaceRow key={row.id} title={row.title} places={row.places} href={row.href} eagerCount={index === 0 ? EAGER_HOME_CARDS : undefined} />
      ))}
    </div>
  );
};

export default HomeSections;
