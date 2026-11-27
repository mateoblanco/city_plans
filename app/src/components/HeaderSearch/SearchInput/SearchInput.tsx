import Search from "@/components/Search/Search";
import { searchPlaces } from "@/server/search";
import { emptyBar } from "@/server/search/intents";
import { readParams, toSearchOptions, toSearchUrl, type SearchParams } from "@/components/pages/SearchPage/utils/search-params";
import { clearTextHref } from "@/components/pages/SearchPage/utils/search-href";

type Props = {
  searchParams: SearchParams;
};

/** Input del header: sale apenas llegan los parámetros, sin esperar la búsqueda. */
const SearchInput = async (props: Props) => {
  const params = await readParams(props.searchParams);
  const { query, filters, loc, intent, sub } = params;
  const state = toSearchUrl(params);
  // La búsqueda sin texto del × (y Escape): con lo que la búsqueda puso en la barra, así que es una promesa que el input
  // no espera (searchPlaces está deduplicada por request: es la misma de la barra y los resultados). Si falla, la URL.
  const clearHref = query
    ? searchPlaces(query, toSearchOptions(params))
        .then((response) => clearTextHref(state, response.interpreted.chips, response.bar))
        .catch(() => clearTextHref(state, [], emptyBar()))
    : undefined;
  // Sin key: el input no se vuelve a montar al navegar (después de borrar, el foco queda); Search toma el q nuevo.
  return <Search rotatingPlaceholder defaultValue={query} filters={filters} loc={loc} intent={intent} sub={sub} clearHref={clearHref} />;
};

export default SearchInput;
