"use client";

import Search from "@/components/Search/Search";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

const SearchError = (props: Props) => {
  return (
    <main>
      <Search />
      <div role="alert">
        <p>No pudimos completar la búsqueda.</p>
        <button type="button" onClick={props.reset}>
          Reintentar
        </button>
      </div>
    </main>
  );
};

export default SearchError;
