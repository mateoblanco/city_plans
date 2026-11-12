"use client";

import { useEffect, useState } from "react";
import Form from "next/form";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Button from "../base/Button/Button";
import styles from './Search.module.scss';
import { Input } from '@base-ui/react/input';
import ArrowRight from "@/assets/arrow_right.svg";
import { DEFAULT_PLACEHOLDER, HOME_PLACEHOLDERS, PLACEHOLDER_INTERVAL_MS } from "./utils/placeholders";

type Props = {
  defaultValue?: string;
  /**
   * Filtros de la barra, ubicación, intención y sus opciones: escribir otra cosa (o borrar el texto) no los borra, el
   * texto nuevo se combina con ellos. Los chips quitados (remove) sí se van: eran del texto anterior.
   */
  filters?: string | null;
  /** Dónde (`loc`: cerca mío, todo Montevideo o la zona del mapa): se conserva al escribir otro texto. */
  loc?: string | null;
  intent?: string | null;
  sub?: string | null;
  /**
   * La home: el placeholder va rotando entre ejemplos (HOME_PLACEHOLDERS) con una animación. Al tocar el input frena y
   * el ejemplo de ese momento queda como placeholder fijo. Con prefers-reduced-motion no rota: el primer ejemplo, fijo.
   */
  rotatingPlaceholder?: boolean;
};

const Search = (props: Props) => {
  // Sólo espacios cuenta como vacío: la página recorta q igual.
  const [empty, setEmpty] = useState(!props.defaultValue?.trim());
  // Sin texto se puede enviar igual si queda algo que buscar (intención, filtros o ubicación): borrar el texto mantiene
  // la intención.
  const blocked = empty && !props.intent && !props.filters && !props.loc;

  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [stopped, setStopped] = useState(false);
  const reducedMotion = useReducedMotion();
  // Con movimiento reducido no rota: queda el primer ejemplo fijo, como placeholder nativo.
  const rotating = !!props.rotatingPlaceholder && !stopped && !reducedMotion;

  // Rota sólo mientras se ve (input vacío y sin tocar).
  useEffect(() => {
    if (!rotating || !empty) return;
    const timer = setInterval(() => setPlaceholderIndex((index) => (index + 1) % HOME_PLACEHOLDERS.length), PLACEHOLDER_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [rotating, empty]);

  // Rotando, el placeholder nativo va vacío y el texto lo dibuja la capa animada de encima.
  const placeholder = !props.rotatingPlaceholder ? DEFAULT_PLACEHOLDER : rotating ? "" : HOME_PLACEHOLDERS[placeholderIndex];
  const offset = "100%";

  return (
    // Con el botón deshabilitado el navegador ya no envía con Enter; el chequeo cubre cualquier otro envío.
    <Form action="/search" onSubmit={(event) => blocked && event.preventDefault()}>
      <div className={styles.container}>
        <div className={styles.field}>
          <Input
            type="search"
            name="q"
            defaultValue={props.defaultValue}
            onValueChange={(value) => setEmpty(!value.trim())}
            onFocus={() => setStopped(true)}
            autoComplete="off"
            aria-label="Buscar lugares"
            className={styles.input}
            placeholder={placeholder}
          />
          {rotating && empty && (
            <span className={styles.rotatingPlaceholder} aria-hidden>
              {/* initial={false}: el primer ejemplo (el del HTML del servidor) no entra animado. */}
              <AnimatePresence initial={false}>
                <motion.span
                  key={placeholderIndex}
                  className={styles.rotatingText}
                  initial={{ y: offset, opacity: 0 }}
                  animate={{ y: "0%", opacity: 1 }}
                  exit={{ y: `-${offset}`, opacity: 0 }}
                  transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
                >
                  {HOME_PLACEHOLDERS[placeholderIndex]}
                </motion.span>
              </AnimatePresence>
            </span>
          )}
        </div>
        {props.filters && <input type="hidden" name="f" value={props.filters} />}
        {props.loc && <input type="hidden" name="loc" value={props.loc} />}
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
