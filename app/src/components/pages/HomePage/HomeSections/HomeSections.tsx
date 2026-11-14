import { cookies } from "next/headers";
import { homeRows, parseDevNow, type HomeRow } from "@/server/home";
import { LOCATION_COOKIE } from "@/lib/location";
import { MY_CARDS_COOKIE, parseMyCardsCookie } from "@/lib/my-cards";
import { SAVED_COOKIE, parseSavedCookie } from "@/components/pages/SearchPage/utils/saved-cookie";
import { EAGER_HOME_CARDS } from "@/components/pages/SearchPage/utils/eager-images";
import PlaceRow from "./PlaceRow/PlaceRow";
import styles from "./HomeSections.module.scss";

/**
 * Filas de lugares de la home, debajo de los platos (que van en el shell, en HomePage): "Guardados", "Abierto ahora
 * cerca tuyo", las de la franja del día, "Para vos", "Descuentos con <Banco>" y las de siempre (`homeRows` ya las
 * devuelve en ese orden), con las cookies de guardados, de ubicación y de mis tarjetas. Si fallan las filas, quedan los
 * platos.
 */
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const HomeSections = async ({ searchParams }: Props) => {
  const jar = await cookies();
  // `?now=` (hora simulada) sólo en desarrollo: en producción ni se leen los parámetros.
  const now = process.env.NODE_ENV === "development" ? parseDevNow((await searchParams).now) : null;
  const saved = parseSavedCookie(jar.get(SAVED_COOKIE)?.value);
  const userLocation = jar.get(LOCATION_COOKIE)?.value?.slice(0, 50) || null;
  const cards = parseMyCardsCookie(jar.get(MY_CARDS_COOKIE)?.value?.slice(0, 500));
  let rows: HomeRow[];
  try {
    rows = await homeRows(saved, userLocation, cards, now);
  } catch (error) {
    console.error("Fallaron las secciones de la home", error);
    rows = [];
  }

  // Sin filas, nada: un contenedor vacío sumaría el gap de `.content` debajo de los platos.
  if (rows.length === 0) return null;

  return (
    <div className={styles.sections}>
      {rows.map((row, index) => (
        // La primera fila de lugares sigue a la vista al cargar, debajo de los platos: sus primeros logos van eager.
        <PlaceRow key={row.id} title={row.title} places={row.places} href={row.href} eagerCount={index === 0 ? EAGER_HOME_CARDS : undefined} />
      ))}
    </div>
  );
};

export default HomeSections;
