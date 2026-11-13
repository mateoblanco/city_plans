"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import Select from "@/components/base/Select/Select";
import type { SearchLocation } from "@/server/search";
import { setLocationHref, setNeighborhoodsHref, type ChipRef, type SearchUrl } from "@/components/pages/SearchPage/utils/search-href";
import { readLocationCookie, requestLocation } from "@/components/pages/SearchPage/utils/use-location";
import styles from "./LocationSelect.module.scss";

// Valores especiales del select (los barrios son ids en mayúsculas, no chocan).
const NEAR = "near";
const ALL = "all";
const ZONE = "zone";
const LABELS: Record<string, string> = { [NEAR]: "Cerca mío", [ALL]: "Todo Montevideo", [ZONE]: "Zona del mapa" };
const SPECIAL = new Set([NEAR, ALL, ZONE]);
/** Cuánto espera después del último clic para buscar: marcar varios barrios seguidos es una sola búsqueda. */
const APPLY_DELAY_MS = 400;

type Props = {
  options: { id: string; label: string }[];
  /** Los chips de barrio de la búsqueda (del texto o de la barra): los activos y cómo se apagan. */
  chips: ChipRef[];
  state: SearchUrl;
  /** Dónde buscó el servidor (el valor por defecto lo resuelve él): lo que el botón muestra activo. */
  location: SearchLocation;
  /** La home: "Cerca mío" sin ubicación no la pide acá; va a /search con loc=near y la pide LocationGate. */
  deferLocation?: boolean;
};

/** Lo activo según la búsqueda: siempre hay uno. Mientras se pide la ubicación (ask), "Cerca mío". */
const activeOf = (location: SearchLocation, chips: ChipRef[]): string[] => {
  if (location.kind === "neighborhood") return chips.map((chip) => chip.id);
  if (location.kind === "zone") return [ZONE];
  if (location.kind === "all") return [ALL];
  return [NEAR];
};

const sameValues = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

/**
 * Dónde buscar: "Cerca mío", "Todo Montevideo", "Zona del mapa" (sólo si está activa: sale de "Buscar en esta zona") o
 * uno o más barrios. Cerca mío, todo Montevideo y la zona se excluyen entre sí y con los barrios. La elección se aplica
 * sola al dejar de elegir (APPLY_DELAY_MS), con el popup abierto; cerrarlo aplica enseguida lo pendiente. Cada apertura
 * suma una sola entrada al historial. Elegir "Cerca mío" sin ubicación la pide (aunque antes la haya negado).
 */
const LocationSelect = (props: Props) => {
  const router = useRouter();
  const active = activeOf(props.location, props.chips);
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
  const labels = new Map([...Object.entries(LABELS), ...props.options.map((option): [string, string] => [option.id, option.label])]);
  const zoneActive = props.location.kind === "zone";
  const items = [
    { value: NEAR, label: LABELS[NEAR] },
    { value: ALL, label: LABELS[ALL] },
    ...(zoneActive ? [{ value: ZONE, label: LABELS[ZONE] }] : []),
    ...props.options.map((option) => ({ value: option.id, label: option.label })),
  ];

  useEffect(() => () => clearTimeout(pending.current?.timer), []);

  const go = (href: string) => {
    const navigate = pushed.current ? router.replace : router.push;
    pushed.current = true;
    startNavigation(() => navigate(href));
  };

  const apply = (values: string[]) => {
    if (sameValues(values, applied.current)) return;
    applied.current = values;
    if (values.includes(ZONE)) return;
    if (values.includes(ALL)) return go(setLocationHref(props.state, "all", props.chips));
    if (!values.includes(NEAR)) return go(setNeighborhoodsHref(props.state, values, props.chips));
    // Cerca mío: con la ubicación ya en la cookie (o desde la home), directo; si no, se pide acá (el diálogo del navegador).
    if (props.deferLocation || readLocationCookie()?.kind === "coords") return go(setLocationHref(props.state, "near", props.chips));
    setLocating(true);
    void requestLocation().then((result) => {
      setLocating(false);
      if (result === "found") go(setLocationHref(props.state, "near", props.chips));
      else {
        setFailed(true);
        setDraft(active);
        applied.current = active;
      }
    });
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

  // Una opción especial reemplaza todo; un barrio se suma a los barrios. Desmarcar lo único elegido no deja nada: es
  // "Todo Montevideo" (desmarcar una opción especial no hace nada).
  const onValueChange = (next: string[]) => {
    const added = next.find((item) => !selected.includes(item));
    const values =
      added !== undefined && SPECIAL.has(added) ? [added]
      : added !== undefined ? [...selected.filter((item) => !SPECIAL.has(item)), added]
      : next.length ? next
      : selected.some((item) => SPECIAL.has(item)) ? selected
      : [ALL];
    setDraft(values);
    schedule(values);
  };

  const triggerLabel = () => {
    if (locating) return `${LABELS[NEAR]}…`;
    const names = selected.map((id) => labels.get(id) ?? id);
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} y ${names[1]}`;
    return `${names[0]} +${names.length - 1}`;
  };

  return (
    <>
      {/* Cerca mío, todo Montevideo y la zona arriba, separados de la lista de barrios. */}
      <Select
        label="Dónde"
        items={items}
        value={selected}
        onValueChange={onValueChange}
        open={open}
        onOpenChange={onOpenChange}
        triggerLabel={triggerLabel}
        active={!(selected.length === 1 && selected[0] === ALL)}
        separatorAfter={zoneActive ? ZONE : ALL}
      />
      {failed && (
        <p className={styles.notice} role="status">
          No pudimos obtener tu ubicación.
        </p>
      )}
    </>
  );
};

export default LocationSelect;
