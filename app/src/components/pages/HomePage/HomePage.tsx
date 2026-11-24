import { Suspense } from "react";
import Footer from "@/components/Footer/Footer";
import HeaderSearch from "@/components/HeaderSearch/HeaderSearch";
import SkipLinks from "@/components/SkipLinks/SkipLinks";
import { SKIP_TARGETS } from "@/components/SkipLinks/utils/skip-targets";
import HomeLocation from "./HomeLocation/HomeLocation";
import HomeWelcome from "./HomeWelcome/HomeWelcome";
import HomeDishes from "./HomeSections/HomeDishes/HomeDishes";
import HomeSections from "./HomeSections/HomeSections";
import HomeGuides from "./HomeGuides/HomeGuides";
import HomeSectionsSkeleton from "./HomeSections/HomeSectionsSkeleton/HomeSectionsSkeleton";
import { jsonLdScript } from "../PlacePage/utils/structured-data";
import { homeJsonLd } from "./utils/structured-data";
import { SITE_URL } from "@/lib/site";
import styles from "./HomePage.module.scss";

/** El h1 de la home: no se ve (el header es el de /search), sólo para lectores de pantalla y buscadores. */
const HOME_HEADING = "Lugares para salir en Montevideo";

type Props = {
  /** Sólo en desarrollo: `?now=` simula la hora de las filas (server/home/dev-now.ts). En producción no se lee. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const HomePage = ({ searchParams }: Props) => {
  return (
    <>
      <SkipLinks links={[{ target: SKIP_TARGETS.content, label: "Ir al contenido" }]} />
      {/* El header de /search (buscador, filtros e intenciones), sin mapa: todo lleva a /search. */}
      <HeaderSearch />
      <main id={SKIP_TARGETS.content} data-skip-target>
        {/* WebSite y Organization (nombre del sitio y logo en Google). */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(homeJsonLd(SITE_URL)) }} />
        <h1 className={styles.heading}>{HOME_HEADING}</h1>
        <div className={styles.content}>
          {/* Primera fila, sin cookies: va en el shell estático (su primera foto es el LCP), sin esperar a las filas. */}
          <HomeDishes eager />
          {/* Lee las cookies de guardados y de ubicación: el resto de la home no espera por ellas. */}
          <Suspense fallback={<HomeSectionsSkeleton />}>
            <HomeSections searchParams={searchParams} />
            {/* Al final, después de todas las filas (en el mismo Suspense: no aparece antes ni las corre). Cacheada, sin cookies. */}
            <HomeGuides />
          </Suspense>
        </div>
        {/* Con el permiso ya dado, actualiza la ubicación sin preguntar; nunca la pide. */}
        <HomeLocation />
      </main>
      <Footer />
      {/* Bienvenida (primera visita): la decide el cliente después de cargar; nunca va en el HTML del servidor. */}
      <Suspense fallback={null}>
        <HomeWelcome />
      </Suspense>
    </>
  );
};

export default HomePage;
