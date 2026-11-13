import { Suspense } from "react";
import Header from "@/components/Header/Header";
import Search from "@/components/Search/Search";
import type { SearchParams } from "@/components/pages/SearchPage/utils/search-params";
import SearchBar from "./SearchBar/SearchBar";
import SearchInput from "./SearchInput/SearchInput";
import IntentTabs from "./IntentTabs/IntentTabs";
import SearchTabs from "./SearchTabs/SearchTabs";
import { emptyBar } from "@/server/search/intents";
import HeaderBack from "@/components/Header/HeaderBack/HeaderBack";
import styles from "./HeaderSearch.module.scss";

type Props = {
  /** Sin searchParams, la home: el buscador con ejemplos rotando, sin volver, y la barra vacía (todo lleva a /search). */
  searchParams?: SearchParams;
};

/**
 * Header de /search: logo, pestañas de intención sobre el input y usuario arriba; la barra de filtros abajo, centrada.
 * En mobile, sin logo y con las pestañas y los filtros en una sola línea con scroll cada uno.
 * Con cacheComponents, lo que lee searchParams (dato de cada request) va dentro de Suspense. Input y barra van en
 * filas distintas del header, cada uno en su Suspense: el input sale apenas llegan los parámetros y la barra espera
 * la búsqueda. La home usa el mismo header, sin parámetros.
 */
const HeaderSearch = (props: Props) => {
  return (
    <Header
      compactBelow="md"
      sticky={!props.searchParams}
      tabs={
        props.searchParams ? (
          <Suspense fallback={<IntentTabs state={{ q: "" }} bar={null} />}>
            <SearchTabs searchParams={props.searchParams} />
          </Suspense>
        ) : (
          <IntentTabs state={{ q: "" }} bar={emptyBar()} home />
        )
      }
      bottom={
        // Mientras llega la barra, su primera línea ya ocupa su alto: el header no crece después (CLS).
        <Suspense fallback={<div className={styles.barPlaceholder} aria-hidden="true" />}>
          <SearchBar searchParams={props.searchParams} />
        </Suspense>
      }
    >
      {/* Mobile: la flecha de volver y el input en la misma línea. Desde md, sólo el input (la línea no es una caja). */}
      {props.searchParams ? (
        <div className={styles.searchLine}>
          <HeaderBack />
          <Suspense fallback={<Search />}>
            <SearchInput searchParams={props.searchParams} />
          </Suspense>
        </div>
      ) : (
        <Search rotatingPlaceholder />
      )}
    </Header>
  );
};

export default HeaderSearch;
