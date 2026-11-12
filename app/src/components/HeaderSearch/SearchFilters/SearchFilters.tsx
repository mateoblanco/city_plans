import { searchPlaces } from "@/server/search";
import FilterBar from "../FilterBar/FilterBar";
import { loadFilterBarData } from "../FilterBar/utils/filter-bar-data";
import { toSearchOptions, toSearchUrl, type Params } from "@/components/pages/SearchPage/utils/search-params";

type Props = {
  params: Params;
};

/**
 * La barra es el único lugar donde se ven y cambian los filtros (los detecte el texto o no): intención,
 * sub-filtros y lo que pidió el texto sin botón propio (platos, tags). Preferencias, vibe, precio, exclusiones
 * y día/hora siguen ordenando o filtrando, pero se cambian editando el texto.
 * Usa la misma búsqueda que SearchResults (searchPlaces está deduplicada por request).
 */
const SearchFilters = async (props: Props) => {
  // Barrios y descuentos de la barra en paralelo con la búsqueda, no después.
  const [response, data] = await Promise.all([
    searchPlaces(props.params.query, toSearchOptions(props.params)).catch(() => null),
    loadFilterBarData(),
  ]);
  // Si la búsqueda falla, el error con "Reintentar" lo muestra SearchResults.
  if (!response) return null;
  return <FilterBar state={toSearchUrl(props.params)} chips={response.interpreted.chips} bar={response.bar} location={response.location} data={data} />;
};

export default SearchFilters;
