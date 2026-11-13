import { cookies } from "next/headers";
import { homeRows, type HomeRow } from "@/server/home";
import { LOCATION_COOKIE } from "@/lib/location";
import { SAVED_COOKIE, parseSavedCookie } from "@/components/pages/SearchPage/utils/saved-cookie";
import { EAGER_HOME_CARDS } from "@/components/pages/SearchPage/utils/eager-images";
import HomeDishes from "./HomeDishes/HomeDishes";
import PlaceRow from "./PlaceRow/PlaceRow";
import styles from "./HomeSections.module.scss";

/** Las filas de cada persona: van antes de los platos; las del config, después. */
const PERSONAL_ROWS = new Set(["saved", "near", "for_you"]);

type RowsProps = {
  rows: HomeRow[];
  /** La primera fila de la home: sus primeras cards llevan el logo eager. */
  first: boolean;
};

const Rows = (props: RowsProps) =>
  props.rows.map((row, index) => (
    <PlaceRow key={row.id} title={row.title} places={row.places} href={row.href} eagerCount={props.first && index === 0 ? EAGER_HOME_CARDS : undefined} />
  ));

/**
 * Filas de la home debajo del header: "Guardados", "Abierto ahora cerca tuyo" y "Para vos" salen de las cookies de
 * guardados y de ubicación; después los platos y las filas del config, que vienen de la caché. Si fallan las filas,
 * quedan los platos.
 */
const HomeSections = async () => {
  const jar = await cookies();
  const saved = parseSavedCookie(jar.get(SAVED_COOKIE)?.value);
  const userLocation = jar.get(LOCATION_COOKIE)?.value?.slice(0, 50) || null;
  let rows: HomeRow[];
  try {
    rows = await homeRows(saved, userLocation);
  } catch (error) {
    console.error("Fallaron las secciones de la home", error);
    rows = [];
  }
  const personal = rows.filter((row) => PERSONAL_ROWS.has(row.id));
  const rest = rows.filter((row) => !PERSONAL_ROWS.has(row.id));

  return (
    <div className={styles.sections}>
      <Rows rows={personal} first />
      <HomeDishes />
      <Rows rows={rest} first={personal.length === 0} />
    </div>
  );
};

export default HomeSections;
