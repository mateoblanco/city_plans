import { Suspense } from "react";
import Header from "@/components/Header/Header";
import Search from "@/components/Search/Search";
import SkipLinks from "@/components/SkipLinks/SkipLinks";
import { SKIP_TARGETS } from "@/components/SkipLinks/utils/skip-targets";
import HeroSearch, { HOME_HEADING } from "./HeroSearch/HeroSearch";
import HomeShortcuts from "./HomeShortcuts/HomeShortcuts";
import HomeSections from "./HomeSections/HomeSections";
import HomeSectionsSkeleton from "./HomeSections/HomeSectionsSkeleton/HomeSectionsSkeleton";
import styles from "./HomePage.module.scss";

const HomePage = () => {
  return (
    <>
      <SkipLinks links={[{ target: SKIP_TARGETS.content, label: "Ir al contenido" }]} />
      {/* En mobile el header es el buscador con los accesos (el hero no se muestra); en desktop, sólo el logo. */}
      <Header compactBelow="md" mobileOnlyContent bottom={<HomeShortcuts layout="scroll" />}>
        <Search rotatingPlaceholder />
      </Header>
      <main id={SKIP_TARGETS.content} data-skip-target>
        {/* Mobile: el hero (con el h1) no se muestra; el mismo h1, visualmente oculto. Desde md no está (va el del hero). */}
        <h1 className={styles.mobileHeading}>{HOME_HEADING}</h1>
        <HeroSearch />
        {/* Lee las cookies de guardados y likes ("Guardados", "Para vos"): el resto de la home no espera por ellas. */}
        <Suspense fallback={<HomeSectionsSkeleton />}>
          <HomeSections />
        </Suspense>
      </main>
    </>
  );
};

export default HomePage;
