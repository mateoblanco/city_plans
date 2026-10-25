import Search from "@/components/Search/Search";
import { readParams, type SearchParams } from "@/components/pages/SearchPage/utils/search-params";

type Props = {
  searchParams: SearchParams;
};

/** Input del header: sale apenas llegan los parámetros, sin esperar la búsqueda. */
const SearchInput = async (props: Props) => {
  const { query, filters, near } = await readParams(props.searchParams);
  // key: al navegar a otra búsqueda el input toma el nuevo q.
  return <Search key={query} defaultValue={query} filters={filters} near={near} />;
};

export default SearchInput;
