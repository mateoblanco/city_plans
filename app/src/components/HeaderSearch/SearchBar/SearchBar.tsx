import { Suspense } from "react";
import { isEmpty, readParams, toSearchUrl, type SearchParams } from "@/components/pages/SearchPage/utils/search-params";
import { emptyBar } from "@/server/search/intents";
import FilterBar from "../FilterBar/FilterBar";
import SearchFilters from "../SearchFilters/SearchFilters";
import { loadFilterBarData } from "../FilterBar/utils/filter-bar-data";
import { provisionalBar } from "./utils/provisional-bar";

type Props = {
  /** Sin searchParams (la home): la barra vacía, con cada filtro e intención llevando a /search. */
  searchParams?: SearchParams;
};

/**
 * Barra de filtros del header. Mientras no hay parámetros ni barrios y descuentos, el skeleton de HeaderSearch; con
 * ellos, ya la barra (clickeable) con lo que dice la URL; con la búsqueda, la definitiva, con lo que detectó el texto.
 */
const SearchBar = async (props: Props) => {
  const params = props.searchParams ? await readParams(props.searchParams) : null;
  // Barrios y descuentos (cacheados por horas): la búsqueda ya arrancó en paralelo (SearchResults y SearchTabs).
  const data = await loadFilterBarData();
  // Sin texto, filtros ni intención (o la home): la barra vacía, sin buscar. En la home, "Cerca mío" no pide la
  // ubicación: lleva a /search, que la pide ahí.
  if (!params || isEmpty(params))
    return (
      <FilterBar
        state={{ q: "", debug: params?.debug }}
        chips={[]}
        bar={emptyBar()}
        location={{ kind: "all", reason: "default" }}
        data={data}
        deferLocation={!params}
      />
    );

  const provisional = provisionalBar(params);
  return (
    // Sin key: al refinar o quitar un chip la barra anterior queda visible hasta que llega la nueva (la provisoria
    // sale sólo en la primera carga).
    <Suspense
      fallback={
        <FilterBar
          state={toSearchUrl(params)}
          chips={provisional.chips}
          bar={provisional.bar}
          location={provisional.location}
          data={data}
          pendingSubs={provisional.pendingSubs}
        />
      }
    >
      <SearchFilters params={params} />
    </Suspense>
  );
};

export default SearchBar;
