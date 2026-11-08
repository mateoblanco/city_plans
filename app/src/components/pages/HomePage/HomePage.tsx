import { Suspense } from "react";
import Header from "@/components/Header/Header";
import Search from "@/components/Search/Search";
import HeroSearch from "./HeroSearch/HeroSearch";
import HomeShortcuts from "./HomeShortcuts/HomeShortcuts";
import HomeSections from "./HomeSections/HomeSections";
import HomeSectionsSkeleton from "./HomeSections/HomeSectionsSkeleton/HomeSectionsSkeleton";

const HomePage = () => {
  return (
    <section>
      {/* En mobile el header es el buscador con los accesos (el hero no se muestra); en desktop, sólo el logo. */}
      <Header compactBelow="md" mobileOnlyContent bottom={<HomeShortcuts layout="scroll" />}>
        <Search />
      </Header>
      <HeroSearch />
      {/* Lee las cookies de guardados y likes ("Guardados", "Para vos"): el resto de la home no espera por ellas. */}
      <Suspense fallback={<HomeSectionsSkeleton />}>
        <HomeSections />
      </Suspense>
    </section>
  );
};

export default HomePage;
