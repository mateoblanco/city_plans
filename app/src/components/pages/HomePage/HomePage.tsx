import { Suspense } from "react";
import Header from "@/components/Header/Header";
import HeroSearch from "./HeroSearch/HeroSearch";
import HomeSections from "./HomeSections/HomeSections";
import HomeSectionsSkeleton from "./HomeSections/HomeSectionsSkeleton/HomeSectionsSkeleton";

const HomePage = () => {
  return (
    <section>
      <Header />
      <HeroSearch />
      {/* Lee la cookie de likes ("Para vos"): el resto de la home no espera por ella. */}
      <Suspense fallback={<HomeSectionsSkeleton />}>
        <HomeSections />
      </Suspense>
    </section>
  );
};

export default HomePage;
