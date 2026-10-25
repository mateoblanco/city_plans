import { Suspense } from "react";
import { isEmpty, readParams, type SearchParams } from "@/components/pages/SearchPage/utils/search-params";
import { emptyBar } from "@/server/search/intents";
import FilterBar from "../FilterBar/FilterBar";
import SearchFilters from "../SearchFilters/SearchFilters";

type Props = {
  searchParams: SearchParams;
};

/** Barra de filtros del header: espera la búsqueda. */
const SearchBar = async (props: Props) => {
  const params = await readParams(props.searchParams);
  // Sin texto, filtros ni intención: la barra vacía, sin buscar.
  if (isEmpty(params)) return <FilterBar state={{ q: "", debug: params.debug }} chips={[]} bar={emptyBar()} needsLocation={false} />;

  return (
    // Sin key: al refinar o quitar un chip la barra anterior queda visible hasta que llega la nueva.
    <Suspense fallback={null}>
      <SearchFilters params={params} />
    </Suspense>
  );
};

export default SearchBar;
