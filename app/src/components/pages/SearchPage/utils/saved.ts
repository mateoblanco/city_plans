import { createPlaceList } from "./place-list";
import { MAX_SAVED, SAVED_COOKIE } from "./saved-cookie";

/**
 * Guardados ("quiero ir"): una lista de pendientes, independiente de los likes. En localStorage cada entrada lleva la
 * fecha en que se guardó (para ordenar y, más adelante, preguntar "¿fuiste?"); la cookie espejo lleva sólo los ids, del
 * más reciente al más viejo, para que la home renderice "Guardados" en el servidor. No alimenta el perfil de gustos.
 */
export const SAVED_KEY = "cityPlans.saved";

const saved = createPlaceList({ storageKey: SAVED_KEY, cookieName: SAVED_COOKIE, max: MAX_SAVED, dated: true });

/** Ids guardados, del más reciente al más viejo. null: localStorage no está disponible (o falla). */
export const readSaved = saved.read;

/** Guardados con su fecha (ISO), del más reciente al más viejo. null: localStorage no está disponible. */
export const readSavedEntries = saved.readEntries;

/** Guarda o saca el lugar (el que se guarda va primero, con la fecha de ahora). false si no se pudo guardar. */
export const toggleSaved = saved.toggle;

/** Borra todos los guardados (localStorage y cookie). */
export const clearSaved = saved.clear;

/** Guardados actuales; available false si localStorage no funciona (no se muestra el botón). */
export const useSaved = saved.useList;
