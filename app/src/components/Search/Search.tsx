import Form from "next/form";

type SearchProps = {
  defaultValue?: string;
};

const Search = ({ defaultValue }: SearchProps) => {
  return (
    <Form action="/search">
      <input type="search" name="q" defaultValue={defaultValue} aria-label="Buscar lugares" />
      <button type="submit">Buscar</button>
    </Form>
  );
};

export default Search;
