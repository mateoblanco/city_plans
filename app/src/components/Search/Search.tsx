"use client";

import { useState } from "react";
import Form from "next/form";
import Button from "../base/Button/Button";
import styles from './Search.module.scss';
import { Input } from '@base-ui/react/input';
import ArrowRight from "@/assets/arrow_right.svg";

type Props = {
  defaultValue?: string;
  /**
   * Filtros de la barra, ubicación, intención y sus opciones: escribir otra cosa (o borrar el texto) no los borra, el
   * texto nuevo se combina con ellos. Los chips quitados (remove) sí se van: eran del texto anterior.
   */
  filters?: string | null;
  near?: string | null;
  intent?: string | null;
  sub?: string | null;
};

const Search = (props: Props) => {
  // Sólo espacios cuenta como vacío: la página recorta q igual.
  const [empty, setEmpty] = useState(!props.defaultValue?.trim());
  // Sin texto se puede enviar igual si queda algo que buscar (intención, filtros o ubicación): borrar el texto mantiene
  // la intención.
  const blocked = empty && !props.intent && !props.filters && !props.near;

  return (
    // Con el botón deshabilitado el navegador ya no envía con Enter; el chequeo cubre cualquier otro envío.
    <Form action="/search" onSubmit={(event) => blocked && event.preventDefault()}>
      <div className={styles.container}>
        <Input type="search" name="q" defaultValue={props.defaultValue} onValueChange={(value) => setEmpty(!value.trim())} autoComplete="off" aria-label="Buscar lugares" className={styles.input} placeholder="Bar para salir a tomar algo con amigos" />
        {props.filters && <input type="hidden" name="f" value={props.filters} />}
        {props.near && <input type="hidden" name="near" value={props.near} />}
        {props.intent && <input type="hidden" name="intent" value={props.intent} />}
        {props.intent && props.sub && <input type="hidden" name="sub" value={props.sub} />}
        {/* Mobile: sólo la flecha (label queda como aria-label). Desde md: el texto. Se oculta con CSS, así que nunca hay dos visibles. */}
        <span className={styles.submitMobile}>
          <Button label="Buscar" type="submit" disabled={blocked} variant="primary" size="md" onlyIcon icon={<ArrowRight aria-hidden />} />
        </span>
        <span className={styles.submitDesktop}>
          <Button label="Buscar" type="submit" disabled={blocked} variant="primary" size="md" />
        </span>
      </div>
    </Form>
  );
};

export default Search;
