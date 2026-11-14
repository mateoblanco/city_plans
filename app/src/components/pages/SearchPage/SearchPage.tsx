import { Suspense } from "react";
import HeaderSearch from "@/components/HeaderSearch/HeaderSearch";
import SkipLinks from "@/components/SkipLinks/SkipLinks";
import { SKIP_TARGETS } from "@/components/SkipLinks/utils/skip-targets";
import PageScrollLock from "./PageScrollLock/PageScrollLock";
import MapSync from "./Results/Map/MapSync/MapSync";
import ResultsSkeleton from "./Results/ResultsSkeleton/ResultsSkeleton";
import SearchResults from "./Results/SearchResults/SearchResults";
import { readParams, searchKey, type SearchParams } from "./utils/search-params";
import styles from "./SearchPage.module.scss";

type ResultsProps = {
  searchParams: SearchParams;
};

// Lee los parámetros (instantáneo) fuera del Suspense de la búsqueda: con ellos arma la key, para que el skeleton
// vuelva a aparecer en cada búsqueda nueva. La key vuelve a montar sólo la lista: el mapa (MapSync) está afuera. Sin
// texto, filtros ni intención trae todos los publicados.
const Results = async (props: ResultsProps) => {
  const params = await readParams(props.searchParams);

  return (
    <Suspense key={searchKey(params)} fallback={<ResultsSkeleton />}>
      <SearchResults params={params} />
    </Suspense>
  );
};

type Props = {
  searchParams: SearchParams;
};

const SearchPage = (props: Props) => {
  return (
    <>
      <PageScrollLock />
      {/* Sin lista (la búsqueda falló), "Ir a los resultados" va al <main>. "Ir al mapa", sólo en desktop: en mobile el
          mapa queda detrás del panel. */}
      <SkipLinks
        links={[
          { target: SKIP_TARGETS.results, label: "Ir a los resultados", fallback: SKIP_TARGETS.content },
          { target: SKIP_TARGETS.map, label: "Ir al mapa", desktopOnly: true },
        ]}
      />
      <HeaderSearch searchParams={props.searchParams} />

      <main id={SKIP_TARGETS.content} className={styles.list} data-skip-target>
        {/* El mapa queda montado entre búsquedas: la key del Suspense de Results aplica sólo a la lista. */}
        <MapSync>
          <Suspense fallback={<ResultsSkeleton />}>
            <Results searchParams={props.searchParams} />
          </Suspense>
        </MapSync>
      </main>
    </>
  );
};

export default SearchPage;
