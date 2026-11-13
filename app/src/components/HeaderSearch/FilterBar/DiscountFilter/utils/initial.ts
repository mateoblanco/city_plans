/**
 * Lo marcado al abrir el panel de Descuentos: lo de la URL si hay; si no, mis tarjetas (sólo las que tienen chip),
 * premarcadas pero sin aplicar: la búsqueda no cambia hasta que se toca algo.
 */
export const initialDiscountSelection = (active: string[], myCards: string[], optionKeys: string[]): string[] =>
  active.length > 0 ? active : optionKeys.filter((key) => myCards.includes(key));

/** Al aplicar, la selección pasa a ser mis tarjetas; sacar todos los descuentos no las borra. */
export const shouldSaveCards = (applied: string[]) => applied.length > 0;
