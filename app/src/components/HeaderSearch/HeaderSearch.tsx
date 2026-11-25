import { Suspense } from "react";
import Header from "@/components/Header/Header";
import Search from "@/components/Search/Search";
import type { SearchParams } from "@/components/pages/SearchPage/utils/search-params";
import SearchBar from "./SearchBar/SearchBar";
import SearchInput from "./SearchInput/SearchInput";
import IntentTabs from "./IntentTabs/IntentTabs";
import SearchTabs from "./SearchTabs/SearchTabs";
import FilterReveal from "./FilterReveal/FilterReveal";
import FilterBarSkeleton from "./FilterBar/FilterBarSkeleton/FilterBarSkeleton";
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
          // Mobile: la flecha de volver al principio de la línea de las pestañas. Desde md, sólo las pestañas (la línea
          // no es una caja y HeaderBack no se muestra).
          <div className={styles.tabsLine}>
            <HeaderBack />
            <Suspense fallback={<IntentTabs state={{ q: "" }} bar={null} afterBack />}>
              <SearchTabs searchParams={props.searchParams} />
            </Suspense>
          </div>
        ) : (
          <IntentTabs state={{ q: "" }} bar={emptyBar()} home />
        )
      }
      collapsibleBottom={!props.searchParams}
      bottom={
        // Mientras llegan los parámetros y los barrios y descuentos, píldoras del alto de la barra: el header no crece
        // después (CLS). Con la búsqueda pendiente, la barra provisoria (SearchBar).
        props.searchParams ? (
          <Suspense fallback={<FilterBarSkeleton />}>
            <SearchBar searchParams={props.searchParams} />
          </Suspense>
        ) : (
          // La home: la fila se guarda al bajar y vuelve al tope o al enfocar el buscador.
          <FilterReveal>
            <Suspense fallback={<FilterBarSkeleton />}>
              <SearchBar />
            </Suspense>
          </FilterReveal>
        )
      }
    >
      {props.searchParams ? (
        <Suspense fallback={<Search />}>
          <SearchInput searchParams={props.searchParams} />
        </Suspense>
      ) : (
        <Search rotatingPlaceholder />
      )}
    </Header>
  );
};

export default HeaderSearch;
