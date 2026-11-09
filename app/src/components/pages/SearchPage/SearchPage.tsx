import { Suspense } from "react";
import HeaderSearch from "@/components/HeaderSearch/HeaderSearch";
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
    <section>
      <PageScrollLock />
      <HeaderSearch searchParams={props.searchParams} />

      <div className={styles.list}>
        {/* El mapa queda montado entre búsquedas: la key del Suspense de Results aplica sólo a la lista. */}
        <MapSync>
          <Suspense fallback={<ResultsSkeleton />}>
            <Results searchParams={props.searchParams} />
          </Suspense>
        </MapSync>
      </div>
    </section>
  );
};

export default SearchPage;
