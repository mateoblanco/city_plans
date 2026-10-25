"use client";

import { Select } from "@base-ui/react/select";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { nearHref, nearParam, setNeighborhoodsHref, type ChipRef, type SearchUrl } from "@/components/pages/SearchPage/utils/search-href";
import styles from "./NeighborhoodSelect.module.scss";

const ALL = "Todos los barrios";
/** Valor de "Cerca mío" en el select (los barrios son ids en mayúsculas, no chocan). */
const NEAR = "near";
const NEAR_LABEL = "Cerca mío";
/** Cuánto espera después del último clic para buscar: marcar varios barrios seguidos es una sola búsqueda. */
const APPLY_DELAY_MS = 400;

/** El pedido automático (cuando el texto dice "cerca mío") se hace una sola vez por sesión. */
const AUTO_ASKED_KEY = "salimos:near-auto-asked";

const firstAutoAsk = () => {
  try {
    if (sessionStorage.getItem(AUTO_ASKED_KEY)) return false;
    sessionStorage.setItem(AUTO_ASKED_KEY, "1");
    return true;
  } catch {
    // Sin storage no hay forma de recordar que ya se pidió: mejor no pedir solo.
    return false;
  }
};

const CaretUpDownIcon = () => (
  <svg className={styles.icon} width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M11 10H5l3 3.5zm0-4H5l3-3.5z" />
  </svg>
);

const CheckIcon = () => (
  <svg className={styles.icon} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
    <path d="m2.5 8.5 4 4 7-9" />
  </svg>
);

const CaretUpIcon = () => (
  <svg className={styles.icon} width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M12 10H4l4-4.5z" />
  </svg>
);

const CaretDownIcon = () => (
  <svg className={styles.icon} width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M12 6H4l4 4.5z" />
  </svg>
);

type Props = {
  options: { id: string; label: string }[];
  /** Los chips de barrio de la búsqueda (del texto o de la barra): los activos y cómo se apagan. */
  chips: ChipRef[];
  state: SearchUrl;
  /** La búsqueda pidió ubicación (needsLocation) y no hay: pedirla sola, una vez. */
  autoNear: boolean;
};

const sameValues = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

/**
 * Dónde buscar: "Todos los barrios", "Cerca mío" o varios barrios. Cerca mío y los barrios se excluyen. La elección
 * se aplica sola al dejar de elegir (APPLY_DELAY_MS), con el popup abierto; cerrarlo aplica enseguida lo pendiente.
 * Cada apertura suma una sola entrada al historial.
 */
const NeighborhoodSelect = (props: Props) => {
  const router = useRouter();
  const active = [...(props.state.near ? [NEAR] : []), ...props.chips.map((chip) => chip.id)];
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(active);
  const [locating, setLocating] = useState(false);
  const [failed, setFailed] = useState(false);
  const [navigating, startNavigation] = useTransition();
  /** El temporizador de la búsqueda pendiente y la elección que va a aplicar. */
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; values: string[] } | null>(null);
  /** Lo último aplicado en esta apertura (arranca en lo activo), para no buscar dos veces lo mismo. */
  const applied = useRef(active);
  /** Si esta apertura ya sumó una entrada al historial: las siguientes la reemplazan. */
  const pushed = useRef(false);
  // Mientras se pide la ubicación o carga la búsqueda nueva, el botón ya muestra lo elegido.
  const selected = open || locating || navigating ? draft : active;
  const labels = new Map([[NEAR, NEAR_LABEL], ...props.options.map((option): [string, string] => [option.id, option.label])]);
  const items = [{ value: "", label: ALL }, { value: NEAR, label: NEAR_LABEL }, ...props.options.map((option) => ({ value: option.id, label: option.label }))];

  // El estado sólo cambia en los callbacks del navegador, nunca de forma sincrónica.
  const locate = (onFound: (near: string) => void) => {
    if (!("geolocation" in navigator)) return setFailed(true);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        onFound(nearParam(coords.latitude, coords.longitude));
      },
      () => {
        setLocating(false);
        setFailed(true);
      },
      { timeout: 10000, maximumAge: 5 * 60 * 1000 },
    );
  };

  useEffect(() => {
    // replace: volver atrás no tiene que caer en la página que pide la ubicación.
    if (props.autoNear && !props.state.near && "geolocation" in navigator && firstAutoAsk()) {
      navigator.geolocation.getCurrentPosition(({ coords }) => router.replace(nearHref(props.state, coords.latitude, coords.longitude)), () => setFailed(true), {
        timeout: 10000,
        maximumAge: 5 * 60 * 1000,
      });
    }
    // Sólo al montar: cada búsqueda nueva monta el componente de nuevo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => clearTimeout(pending.current?.timer), []);

  const go = (ids: string[], near: string | null) => {
    const href = setNeighborhoodsHref(props.state, ids, props.chips, near);
    const navigate = pushed.current ? router.replace : router.push;
    pushed.current = true;
    startNavigation(() => navigate(href));
  };

  const apply = (values: string[]) => {
    if (sameValues(values, applied.current)) return;
    applied.current = values;
    const ids = values.filter((id) => id !== NEAR);
    if (!values.includes(NEAR)) go(ids, null);
    else if (props.state.near) go(ids, props.state.near);
    else locate((near) => go(ids, near));
  };

  const schedule = (values: string[]) => {
    clearTimeout(pending.current?.timer);
    const timer = setTimeout(() => {
      pending.current = null;
      apply(values);
    }, APPLY_DELAY_MS);
    pending.current = { timer, values };
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setDraft(active);
      setFailed(false);
      applied.current = active;
      pushed.current = false;
      return;
    }
    // Cerrar no espera: aplica ya lo que estaba por salir.
    if (pending.current) {
      clearTimeout(pending.current.timer);
      const { values } = pending.current;
      pending.current = null;
      apply(values);
    }
  };

  // "Todos" ("") va marcado con la elección vacía y la vacía al elegirlo; cerca mío y los barrios se sacan entre sí.
  const value = selected.length ? selected : [""];
  const onValueChange = (next: string[]) => {
    // Contra lo que muestra el select (con "Todos" marcado es [""]), no contra la elección.
    const added = next.find((item) => !value.includes(item));
    const values =
      added === "" ? [] : added === NEAR ? [NEAR] : added !== undefined ? [...selected.filter((item) => item !== NEAR), added] : next.filter((item) => item !== "");
    setDraft(values);
    schedule(values);
  };

  const triggerLabel = () => {
    const names = selected.map((id) => labels.get(id) ?? id);
    if (locating) return `${NEAR_LABEL}…`;
    if (names.length === 0) return ALL;
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} y ${names[1]}`;
    return `${names[0]} +${names.length - 1}`;
  };

  return (
    <>
      <Select.Root multiple items={items} value={value} onValueChange={onValueChange} open={open} onOpenChange={onOpenChange}>
        <Select.Trigger className={styles.trigger} aria-label="Dónde" data-active={selected.length ? "" : undefined}>
          <Select.Value>{triggerLabel}</Select.Value>
          <Select.Icon className={styles.triggerIcon}>
            <CaretUpDownIcon />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          {/* alignItemWithTrigger={false}: se abre debajo, como "Más filtros", en vez de encima del botón. */}
          <Select.Positioner className={styles.positioner} sideOffset={4} alignItemWithTrigger={false}>
            <Select.Popup className={styles.popup}>
              <Select.ScrollUpArrow className={styles.scrollArrow}>
                <CaretUpIcon />
              </Select.ScrollUpArrow>
              <Select.List className={styles.list}>
                {items.map((item) => [
                  <Select.Item key={item.value} value={item.value} className={styles.item}>
                    <Select.ItemIndicator className={styles.itemIndicator}>
                      <CheckIcon />
                    </Select.ItemIndicator>
                    <Select.ItemText className={styles.itemText}>{item.label}</Select.ItemText>
                  </Select.Item>,
                  // "Todos" y "Cerca mío" arriba, separados de la lista de barrios.
                  item.value === NEAR && <Select.Separator key="separator" className={styles.separator} />,
                ])}
              </Select.List>
              <Select.ScrollDownArrow className={styles.scrollArrow}>
                <CaretDownIcon />
              </Select.ScrollDownArrow>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
      {failed && (
        <p className={styles.notice} role="status">
          No pudimos obtener tu ubicación.
        </p>
      )}
    </>
  );
};

export default NeighborhoodSelect;
