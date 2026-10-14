import Form from "next/form";

type SearchProps = {
  defaultValue?: string;
  /** Filtros de la barra y ubicación: escribir otra cosa no los borra. La intención sí: la elige el texto nuevo. */
  filters?: string | null;
  near?: string | null;
};

const Search = ({ defaultValue, filters, near }: SearchProps) => {
  return (
    <Form action="/search">
      <input type="search" name="q" defaultValue={defaultValue} aria-label="Buscar lugares" />
      {filters && <input type="hidden" name="f" value={filters} />}
      {near && <input type="hidden" name="near" value={near} />}
      <button type="submit">Buscar</button>
    </Form>
  );
};

export default Search;
