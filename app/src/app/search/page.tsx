import SearchPage from "@/components/pages/SearchPage/SearchPage";

const Search = async ({ searchParams }: PageProps<"/search">) => {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q : "";

  return (
    <main>
      <SearchPage query={query} />
    </main>
  );
};

export default Search;
