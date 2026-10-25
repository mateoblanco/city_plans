import { Suspense } from "react";
import Header from "@/components/Header/Header";
import Search from "@/components/Search/Search";
import type { SearchParams } from "@/components/pages/SearchPage/utils/search-params";
import SearchBar from "./SearchBar/SearchBar";
import SearchInput from "./SearchInput/SearchInput";

type Props = {
  searchParams: SearchParams;
};

/**
 * Header de /search: logo, input y usuario arriba; la barra de filtros abajo, centrada.
 * Con cacheComponents, lo que lee searchParams (dato de cada request) va dentro de Suspense. Input y barra van en
 * filas distintas del header, cada uno en su Suspense: el input sale apenas llegan los parámetros y la barra espera
 * la búsqueda.
 */
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
