import { Suspense } from "react";
import { isEmpty, readParams, type SearchParams } from "@/components/pages/SearchPage/utils/search-params";
import { emptyBar } from "@/server/search/intents";
import FilterBar from "../FilterBar/FilterBar";
import SearchFilters from "../SearchFilters/SearchFilters";
import { loadFilterBarData } from "../FilterBar/utils/filter-bar-data";

type Props = {
  /** Sin searchParams (la home): la barra vacía, con cada filtro e intención llevando a /search. */
  searchParams?: SearchParams;
};

/** Barra de filtros del header: espera la búsqueda. */
const SearchBar = async (props: Props) => {
  const params = props.searchParams ? await readParams(props.searchParams) : null;
  // Sin texto, filtros ni intención (o la home): la barra vacía, sin buscar. En la home, "Cerca mío" no pide la
  // ubicación: lleva a /search, que la pide ahí.
  if (!params || isEmpty(params))
    return (
      <FilterBar
        state={{ q: "", debug: params?.debug }}
        chips={[]}
        bar={emptyBar()}
        location={{ kind: "all", reason: "default" }}
        data={await loadFilterBarData()}
        deferLocation={!params}
      />
    );

  return (
    // Sin key: al refinar o quitar un chip la barra anterior queda visible hasta que llega la nueva.
    <Suspense fallback={null}>
      <SearchFilters params={params} />
    </Suspense>
  );
};

export default SearchBar;
