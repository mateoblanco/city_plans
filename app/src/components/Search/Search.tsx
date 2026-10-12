import Form from "next/form";

const Search = () => {
  return (
    <Form action="/search">
      <input type="text" name="q" />
      <button type="submit">Buscar</button>
    </Form>
  );
};

export default Search;
