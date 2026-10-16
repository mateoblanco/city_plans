import { Suspense } from "react";
import Header from "@/components/Header/Header";
import Search from "@/components/Search/Search";
import { isEmpty, readParams, type SearchParams } from "@/components/pages/SearchPage/utils/search-params";
import { emptyBar } from "@/server/search/intents";
import FilterBar from "./FilterBar";
import SearchFilters from "./SearchFilters";

// Con cacheComponents, lo que lee searchParams (dato de cada request) va dentro de Suspense.
// Input y barra van en filas distintas del header, cada uno en su Suspense: el input sale apenas llegan los
// parámetros y la barra espera la búsqueda.
type SearchInputProps = {
  searchParams: SearchParams;
};

const SearchInput = async (props: SearchInputProps) => {
  const { query, filters, near } = await readParams(props.searchParams);
  // key: al navegar a otra búsqueda el input toma el nuevo q.
  return <Search key={query} defaultValue={query} filters={filters} near={near} />;
};

type SearchBarProps = {
  searchParams: SearchParams;
};

const SearchBar = async (props: SearchBarProps) => {
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

type Props = {
  searchParams: SearchParams;
};

/** Header de /search: logo, input y usuario arriba; la barra de filtros abajo, centrada. */
const HeaderSearch = (props: Props) => {
  return (
    <Header
      bottom={
        <Suspense fallback={null}>
          <SearchBar searchParams={props.searchParams} />
        </Suspense>
      }
    >
      <Suspense fallback={<Search />}>
        <SearchInput searchParams={props.searchParams} />
      </Suspense>
    </Header>
  );
};

export default HeaderSearch;
