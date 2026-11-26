"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import Form from "next/form";
import { useRouter } from "next/navigation";
import { Button as ButtonBase } from "@base-ui/react/button";
import Button from "../base/Button/Button";
import styles from './Search.module.scss';
import { Input } from '@base-ui/react/input';
import ArrowRight from "@/assets/arrow_right.svg";
import Close from "@/assets/close.svg";
import { createClearer, escapeAction } from "./utils/clear";
import { DEFAULT_PLACEHOLDER, HOME_PLACEHOLDERS, PLACEHOLDER_INTERVAL_MS } from "./utils/placeholders";
import { markSearchOrigin } from "@/lib/product-analytics/track";

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
   * La home, la ficha y las guías: el placeholder va rotando entre ejemplos (HOME_PLACEHOLDERS) con una animación. Al tocar el input frena y
   * el ejemplo de ese momento queda como placeholder fijo. Con prefers-reduced-motion no rota: el primer ejemplo, fijo.
   */
  rotatingPlaceholder?: boolean;
  /**
   * /search con texto: la búsqueda sin texto, con la pestaña y la barra de ahora (SearchInput, clearTextHref). Borrar
   * (× o Escape) va ahí. Sin ella (la home, o /search sin texto en la URL), borrar sólo borra el texto.
   */
  clearHref?: Promise<string>;
  /**
   * El header de la ficha y las guías: más chico (menos padding y el botón más bajo); al enfocarlo vuelve al tamaño de
   * siempre, con transición.
   */
  compact?: boolean;
};

const Search = (props: Props) => {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValueState] = useState(props.defaultValue ?? "");
  const latestValue = useRef(value);
  const setValue = (next: string) => {
    latestValue.current = next;
    setValueState(next);
  };
  // Al navegar a otra búsqueda el input toma el q nuevo sin volver a montarse (así, después de borrar, el foco queda).
  const [syncedDefault, setSyncedDefault] = useState(props.defaultValue);
  if (props.defaultValue !== syncedDefault) {
    setSyncedDefault(props.defaultValue);
    setValueState(props.defaultValue ?? "");
  }
  // Sólo espacios cuenta como vacío: la página recorta q igual.
  const empty = !value.trim();
  // También cuando el valor viene de la URL (el ajuste de arriba).
  useEffect(() => {
    latestValue.current = value;
  }, [value]);
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

  // La home: con cacheComponents, Next oculta la página al navegar (Activity) en vez de desmontarla, y al volver (atrás o
  // el logo) el input seguía con lo buscado. Se vacía al ocultarse (useLayoutEffect: antes de que se oculte, sin mostrar
  // el texto viejo al volver). /search no: su texto sale de la URL.
  const resetOnHide = !!props.rotatingPlaceholder;
  useLayoutEffect(() => {
    if (!resetOnHide) return;
    return () => setValue("");
  }, [resetOnHide]);

  // Borrar el texto: el × y Escape. En /search, además, vuelve a buscar sin texto (una sola vez por borrado).
  const clearHrefRef = useRef(props.clearHref);
  useEffect(() => {
    clearHrefRef.current = props.clearHref;
  }, [props.clearHref]);
  // Se crea con el primer borrado (en un handler): guarda la navegación pendiente entre borrados seguidos.
  const clearer = useRef<(() => Promise<void>) | null>(null);
  const clear = () => {
    setValue("");
    inputRef.current?.focus();
    clearer.current ??= createClearer({
      href: () => clearHrefRef.current,
      // El DOM puede no estar actualizado todavía cuando llega la URL: se mira lo último escrito.
      stillEmpty: () => !latestValue.current.trim(),
      navigate: (href) => router.push(href),
    });
    void clearer.current();
  };

  // Al tocar el input con texto queda todo seleccionado (para reemplazarlo escribiendo); el segundo toque ubica el
  // cursor, como la barra de direcciones. El navegador pone el cursor después del focus (al soltar; en iOS Safari, más
  // tarde todavía): por eso se vuelve a seleccionar al soltar y en la vuelta siguiente.
  const pointerFocus = useRef(false);
  const justFocused = useRef(false);
  const selectAll = () => {
    const input = inputRef.current;
    if (input?.value && document.activeElement === input) input.setSelectionRange(0, input.value.length);
  };
  const onFocus = () => {
    setStopped(true);
    if (!pointerFocus.current) return;
    pointerFocus.current = false;
    justFocused.current = true;
    selectAll();
    setTimeout(selectAll, 0);
  };
  const onMouseUp = (event: MouseEvent<HTMLInputElement>) => {
    if (!justFocused.current) return;
    justFocused.current = false;
    const input = event.currentTarget;
    // Si arrastró para elegir una parte, se respeta.
    if (input.selectionStart !== input.selectionEnd && !(input.selectionStart === 0 && input.selectionEnd === input.value.length)) return;
    event.preventDefault();
    selectAll();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    // Sin esto, Chrome y Safari borran solos un type=search (y disparan su evento search).
    event.preventDefault();
    // Por ahora el buscador no tiene desplegable de sugerencias.
    const action = escapeAction({ hasText: !!event.currentTarget.value, menuOpen: false });
    if (action === "clear") clear();
    else if (action === "blur") event.currentTarget.blur();
  };

  // Los bordes de la píldora (su padding, el hueco hasta el botón) también enfocan el input: si no, eran zonas muertas.
  // preventDefault: el foco no pasa por el body (no cierra el buscador plegado ni hace blur). Los botones, no.
  const onContainerPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, button")) return;
    event.preventDefault();
    pointerFocus.current = document.activeElement !== inputRef.current;
    inputRef.current?.focus();
  };

  // Rotando, el placeholder nativo va vacío y el texto lo dibuja la capa animada de encima.
  const placeholder = !props.rotatingPlaceholder ? DEFAULT_PLACEHOLDER : rotating ? "" : HOME_PLACEHOLDERS[placeholderIndex];

  return (
    // Con el botón deshabilitado el navegador ya no envía con Enter; el chequeo cubre cualquier otro envío.
    <Form
      action="/search"
      onSubmit={(event) => {
        if (blocked) event.preventDefault();
        else markSearchOrigin("bar");
      }}
    >
      <div className={styles.container} data-compact={props.compact || undefined} onPointerDown={onContainerPointerDown}>
        <div className={styles.field}>
          <Input
            ref={inputRef}
            type="search"
            name="q"
            value={value}
            onValueChange={setValue}
            onPointerDown={() => {
              pointerFocus.current = document.activeElement !== inputRef.current;
            }}
            onFocus={onFocus}
            onBlur={() => {
              pointerFocus.current = false;
              justFocused.current = false;
            }}
            onMouseUp={onMouseUp}
            onKeyDown={onKeyDown}
            autoComplete="off"
            aria-label="Buscar lugares"
            className={value ? `${styles.input} ${styles.withClear}` : styles.input}
            placeholder={placeholder}
          />
          {/* Sólo con texto (sin texto no ocupa lugar). type="button": nunca envía el form. */}
          {value && (
            <ButtonBase type="button" className={styles.clear} aria-label="Borrar búsqueda" onClick={clear}>
              <Close aria-hidden />
            </ButtonBase>
          )}
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
