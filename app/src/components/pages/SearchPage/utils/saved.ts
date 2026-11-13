import { createPlaceList } from "./place-list";
import { MAX_SAVED, SAVED_COOKIE } from "./saved-cookie";

/**
 * Guardados: la única lista de lugares del navegador (el corazón de la card y de la ficha). En localStorage cada entrada
 * lleva la fecha en que se guardó (para ordenar y, más adelante, preguntar "¿Fuiste?"); la cookie espejo lleva sólo los
 * ids, del más reciente al más viejo, para que el servidor los lea en ese pedido: la home ("Guardados", "Para vos") y la
 * búsqueda (perfil de gustos, bloques personales). El servidor no guarda nada. Si localStorage falla, la app sigue sin
 * guardados (y sin corazón).
 */
export const SAVED_KEY = "cityPlans.saved";

const saved = createPlaceList({ storageKey: SAVED_KEY, cookieName: SAVED_COOKIE, max: MAX_SAVED, dated: true });

/** Ids guardados, del más reciente al más viejo. null: localStorage no está disponible (o falla). */
export const readSaved = saved.read;

/** Guardados con su fecha (ISO), del más reciente al más viejo. null: localStorage no está disponible. */
export const readSavedEntries = saved.readEntries;

/** Guarda o saca el lugar (el que se guarda va primero, con la fecha de ahora). false si no se pudo guardar. */
export const toggleSaved = saved.toggle;

/** Guarda los lugares que no estaban guardados (los de la bienvenida de la home), con la fecha de ahora; nunca saca. */
export const addSaved = saved.add;

/** Borra todos los guardados (localStorage y cookie). */
export const clearSaved = saved.clear;

/** Guardados actuales; available false si localStorage no funciona (no se muestra el corazón). */
export const useSaved = saved.useList;

/** Si este lugar está guardado (para el corazón de su card o de la ficha): sólo se vuelve a renderizar cuando cambia el de este id. */
export const useIsSaved = (id: string) => saved.useHas(id);

/** Lo que lee useIsSaved: -1 sin localStorage, 1 guardado, 0 no. */
export const savedMembership = saved.membership;
