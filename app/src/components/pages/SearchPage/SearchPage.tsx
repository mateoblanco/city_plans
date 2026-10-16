import { Suspense } from "react";
import HeaderSearch from "@/components/HeaderSearch/HeaderSearch";
import ResultsSkeleton from "./Results/ResultsSkeleton/ResultsSkeleton";
import SearchResults from "./Results/SearchResults/SearchResults";
import { readParams, searchKey, type SearchParams } from "./utils/search-params";
import styles from "./SearchPage.module.scss";

type ResultsProps = {
  searchParams: SearchParams;
};

// Lee los parámetros (instantáneo) fuera del Suspense de la búsqueda: con ellos arma la key, para que el skeleton
// vuelva a aparecer en cada búsqueda nueva. Sin texto, filtros ni intención trae todos los publicados.
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
      <HeaderSearch searchParams={props.searchParams} />

      <div className={styles.list}>
        <Suspense fallback={<ResultsSkeleton />}>
          <Results searchParams={props.searchParams} />
        </Suspense>
      </div>
    </section>
  );
};

export default SearchPage;
