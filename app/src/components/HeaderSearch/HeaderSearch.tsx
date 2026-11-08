import { Suspense } from "react";
import Header from "@/components/Header/Header";
import Search from "@/components/Search/Search";
import type { SearchParams } from "@/components/pages/SearchPage/utils/search-params";
import SearchBar from "./SearchBar/SearchBar";
import SearchInput from "./SearchInput/SearchInput";
import HeaderBack from "@/components/Header/HeaderBack/HeaderBack";
import styles from "./HeaderSearch.module.scss";

type Props = {
  searchParams: SearchParams;
};

/**
 * Header de /search: logo, input y usuario arriba; la barra de filtros abajo, centrada. En mobile, sin logo y con
 * los filtros en una sola línea con scroll.
 * Con cacheComponents, lo que lee searchParams (dato de cada request) va dentro de Suspense. Input y barra van en
 * filas distintas del header, cada uno en su Suspense: el input sale apenas llegan los parámetros y la barra espera
 * la búsqueda.
 */
const HeaderSearch = (props: Props) => {
  return (
    <Header
      compactBelow="md"
      bottom={
        <Suspense fallback={null}>
          <SearchBar searchParams={props.searchParams} />
        </Suspense>
      }
    >
      {/* Mobile: la flecha de volver y el input en la misma línea. Desde md, sólo el input (la línea no es una caja). */}
      <div className={styles.searchLine}>
        <HeaderBack />
        <Suspense fallback={<Search />}>
          <SearchInput searchParams={props.searchParams} />
        </Suspense>
      </div>
    </Header>
  );
};

export default HeaderSearch;
