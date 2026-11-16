"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Form from "next/form";
import Button from "../base/Button/Button";
import styles from './Search.module.scss';
import { Input } from '@base-ui/react/input';
import ArrowRight from "@/assets/arrow_right.svg";
import { DEFAULT_PLACEHOLDER, HOME_PLACEHOLDERS, PLACEHOLDER_INTERVAL_MS } from "./utils/placeholders";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const subscribeReducedMotion = (onChange: () => void) => {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

/** prefers-reduced-motion; false en el servidor (el primer ejemplo del HTML es el mismo en los dos casos). */
const useReducedMotion = () =>
  useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(REDUCED_MOTION).matches, () => false);

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

  // El ejemplo que se ve y el que sale (animación de salida en CSS); leaving es null en el primero, que no se anima, y
  // cuando terminó de salir.
  const [rotation, setRotation] = useState<{ index: number; leaving: number | null }>({ index: 0, leaving: null });
  const placeholderIndex = rotation.index;
  const leavingIndex = rotation.leaving;
  const [stopped, setStopped] = useState(false);
  const reducedMotion = useReducedMotion();
  // Con movimiento reducido no rota: queda el primer ejemplo fijo, como placeholder nativo.
  const rotating = !!props.rotatingPlaceholder && !stopped && !reducedMotion;

  // Rota sólo mientras se ve (input vacío y sin tocar).
  useEffect(() => {
    if (!rotating || !empty) return;
    const timer = setInterval(
      () => setRotation((current) => ({ index: (current.index + 1) % HOME_PLACEHOLDERS.length, leaving: current.index })),
      PLACEHOLDER_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [rotating, empty]);

  // Rotando, el placeholder nativo va vacío y el texto lo dibuja la capa animada de encima.
  const placeholder = !props.rotatingPlaceholder ? DEFAULT_PLACEHOLDER : rotating ? "" : HOME_PLACEHOLDERS[placeholderIndex];

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
              {/* El que sale y el que entra se cruzan (@keyframes en el SCSS). El primero (el del HTML del servidor) no
                  entra animado: sin uno saliendo, no lleva la clase de entrada. */}
              {leavingIndex !== null && (
                <span key={`out-${leavingIndex}`} className={`${styles.rotatingText} ${styles.leaving}`} onAnimationEnd={() => setRotation((current) => ({ ...current, leaving: null }))}>
                  {HOME_PLACEHOLDERS[leavingIndex]}
                </span>
              )}
              <span key={placeholderIndex} className={leavingIndex !== null ? `${styles.rotatingText} ${styles.entering}` : styles.rotatingText}>
                {HOME_PLACEHOLDERS[placeholderIndex]}
              </span>
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
