"use client";

import Search from "@/components/Search/Search";

const SearchError = ({ reset }: { error: Error & { digest?: string }; reset: () => void }) => {
  return (
    <main>
      <Search />
      <div role="alert">
        <p>No pudimos completar la búsqueda.</p>
        <button type="button" onClick={reset}>
          Reintentar
        </button>
      </div>
    </main>
  );
};

export default SearchError;
