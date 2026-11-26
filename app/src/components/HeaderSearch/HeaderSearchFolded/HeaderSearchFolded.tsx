import { Suspense } from "react";
import Header from "@/components/Header/Header";
import HeaderBack from "@/components/Header/HeaderBack/HeaderBack";
import Search from "@/components/Search/Search";
import IntentTabs from "../IntentTabs/IntentTabs";
import SearchBar from "../SearchBar/SearchBar";
import FilterBarSkeleton from "../FilterBar/FilterBarSkeleton/FilterBarSkeleton";
import styles from "./HeaderSearchFolded.module.scss";

type Props = {
  /** El de la página (Header compactBelow): md en las guías, ml en la ficha. También dónde deja de verse la flecha. */
  compactBelow: "md" | "ml";
};

/**
 * Header de la ficha y las guías: el buscador de la home plegado. Sólo se ve el input (en mobile, con la flecha de
 * volver); al enfocarlo se despliegan encima de la página las pestañas de intención y la barra de filtros
 * (Header expandable, SearchExpand). Fuera de /search no hay búsqueda: ninguna pestaña activa ("Todo" lleva a /search)
 * y la barra vacía, como la de la home (todo lleva a /search).
 */
const HeaderSearchFolded = (props: Props) => (
  <Header
    compactBelow={props.compactBelow}
    expandable
    tabs={<IntentTabs state={{ q: "" }} bar={null} />}
    bottom={
      <Suspense fallback={<FilterBarSkeleton />}>
        <SearchBar />
      </Suspense>
    }
  >
    <div className={styles.line}>
      <HeaderBack below={props.compactBelow} />
      <Search rotatingPlaceholder compact />
    </div>
  </Header>
);

export default HeaderSearchFolded;
