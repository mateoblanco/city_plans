import PlaceCard from "@/components/PlaceCard/PlaceCard";

type SearchPageProps = {
  query: string;
};

const PLACEHOLDER_PLACES = [
  "Lugar 1",
  "Lugar 2",
  "Lugar 3",
  "Lugar 4",
  "Lugar 5",
  "Lugar 6",
];

const SearchPage = ({ query }: SearchPageProps) => {
  return (
    <div>
      <div>Resultados para: {query}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)" }}>
        {PLACEHOLDER_PLACES.map((name) => (
          <PlaceCard key={name} name={name} />
        ))}
      </div>
    </div>
  );
};

export default SearchPage;
