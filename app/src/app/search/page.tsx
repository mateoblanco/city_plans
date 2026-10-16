import SearchPage from "@/components/pages/SearchPage/SearchPage";

export default function Search({ searchParams }: PageProps<"/search">) {
  return <SearchPage searchParams={searchParams} />;
}
