"use client";

import { useState } from "react";
import Form from "next/form";
import Button from "../base/Button/Button";
import styles from './Search.module.scss';
import { Input } from '@base-ui/react/input';

type Props = {
  defaultValue?: string;
  /** Filtros de la barra y ubicación: escribir otra cosa no los borra. La intención sí: la elige el texto nuevo. */
  filters?: string | null;
  near?: string | null;
};

const Search = (props: Props) => {
  // Sólo espacios cuenta como vacío: la página recorta q igual.
  const [empty, setEmpty] = useState(!props.defaultValue?.trim());

  return (
    // Con el botón deshabilitado el navegador ya no envía con Enter; el chequeo cubre cualquier otro envío.
    <Form action="/search" onSubmit={(event) => empty && event.preventDefault()}>
      <div className={styles.container}>
        <Input type="search" name="q" defaultValue={props.defaultValue} onValueChange={(value) => setEmpty(!value.trim())} autoComplete="off" aria-label="Buscar lugares" className={styles.input} placeholder="Bar para salir a tomar algo con amigos" />
        {props.filters && <input type="hidden" name="f" value={props.filters} />}
        {props.near && <input type="hidden" name="near" value={props.near} />}
        <Button label="Buscar" type="submit" disabled={empty} />
      </div>
    </Form>
  );
};

export default Search;
