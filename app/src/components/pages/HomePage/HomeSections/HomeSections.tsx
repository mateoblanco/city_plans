import { cookies } from "next/headers";
import { DISCOUNT_ROW_PREFIX, homeRows, type HomeRow } from "@/server/home";
import { LOCATION_COOKIE } from "@/lib/location";
import { MY_CARDS_COOKIE, parseMyCardsCookie } from "@/lib/my-cards";
import { SAVED_COOKIE, parseSavedCookie } from "@/components/pages/SearchPage/utils/saved-cookie";
import { EAGER_HOME_CARDS } from "@/components/pages/SearchPage/utils/eager-images";
import HomeDishes from "./HomeDishes/HomeDishes";
import PlaceRow from "./PlaceRow/PlaceRow";
import styles from "./HomeSections.module.scss";

/** Las filas de cada persona (también "Descuentos con <Banco>"): van antes de los platos; las del config, después. */
const PERSONAL_ROWS = new Set(["saved", "near", "for_you"]);
const isPersonal = (row: HomeRow) => PERSONAL_ROWS.has(row.id) || row.id.startsWith(DISCOUNT_ROW_PREFIX);

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
 * Filas de la home debajo del header: "Guardados", "Abierto ahora cerca tuyo", "Para vos" y "Descuentos con <Banco>"
 * salen de las cookies de guardados, de ubicación y de mis tarjetas; después los platos y las filas del config, que vienen de la caché. Si fallan las filas,
 * quedan los platos.
 */
const HomeSections = async () => {
  const jar = await cookies();
  const saved = parseSavedCookie(jar.get(SAVED_COOKIE)?.value);
  const userLocation = jar.get(LOCATION_COOKIE)?.value?.slice(0, 50) || null;
  const cards = parseMyCardsCookie(jar.get(MY_CARDS_COOKIE)?.value?.slice(0, 500));
  let rows: HomeRow[];
  try {
    rows = await homeRows(saved, userLocation, cards);
  } catch (error) {
    console.error("Fallaron las secciones de la home", error);
    rows = [];
  }
  const personal = rows.filter(isPersonal);
  const rest = rows.filter((row) => !isPersonal(row));

  return (
    <div className={styles.sections}>
      <Rows rows={personal} first />
      <HomeDishes />
      <Rows rows={rest} first={personal.length === 0} />
    </div>
  );
};

export default HomeSections;
