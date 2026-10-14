import { Suspense } from "react";
import Search from "@/components/Search/Search";
import FilterBar from "@/components/pages/SearchPage/FilterBar";
import ResultsSkeleton from "@/components/pages/SearchPage/ResultsSkeleton";
import SearchPage from "@/components/pages/SearchPage/SearchPage";
import styles from "@/components/pages/SearchPage/SearchPage.module.scss";

type SearchParams = PageProps<"/search">["searchParams"];

const MAX_PARAM_LENGTH = 500;

const firstString = (value: string | string[] | undefined) => (typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined);

async function readParams(searchParams: SearchParams) {
  const params = await searchParams;
  const query = (firstString(params.q) ?? "").trim().slice(0, MAX_PARAM_LENGTH);
  const remove = firstString(params.remove)?.slice(0, MAX_PARAM_LENGTH) || null;
  const filters = firstString(params.f)?.slice(0, MAX_PARAM_LENGTH) || null;
  const near = firstString(params.near)?.slice(0, 50) || null;
  const debug = firstString(params.debug) === "1";
  return { query, remove, filters, near, debug };
}

// Con cacheComponents, lo que lee searchParams (dato de cada request) va dentro de Suspense.
const SearchInput = async ({ searchParams }: { searchParams: SearchParams }) => {
  const { query, filters, near } = await readParams(searchParams);
  // key: al navegar a otra búsqueda el input toma el nuevo q.
  return <Search key={query} defaultValue={query} filters={filters} near={near} />;
};

const SearchResults = async ({ searchParams }: { searchParams: SearchParams }) => {
  const { query, remove, filters, near, debug } = await readParams(searchParams);
  // Sin texto ni filtros: sólo la barra, y la columna del mapa reservada igual.
  if (!query && !filters && !near) {
    return (
      <div className={styles.results}>
        <FilterBar state={{ q: "", debug }} chips={[]} needsLocation={false} />
        <div className={styles.map} />
      </div>
    );
  }

  // key: el skeleton vuelve a aparecer en cada búsqueda nueva (refinar o quitar un chip).
  return (
    <Suspense key={`${query}|${remove ?? ""}|${filters ?? ""}|${near ?? ""}|${debug}`} fallback={<ResultsSkeleton />}>
      <SearchPage query={query} remove={remove} filters={filters} near={near} debug={debug} />
    </Suspense>
  );
};

const SearchRoute = ({ searchParams }: PageProps<"/search">) => {
  return (
    <main className={styles.list}>
      <Suspense fallback={<Search />}>
        <SearchInput searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<ResultsSkeleton />}>
        <SearchResults searchParams={searchParams} />
      </Suspense>
    </main>
  );
};

export default SearchRoute;
