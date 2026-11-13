"use client";

import Button from "@/components/base/Button/Button";
import Popover from "@/components/base/Popover/Popover";
import DiscountChoices from "@/components/DiscountChoices/DiscountChoices";
import { CARD_LABELS, discountRows, inOptionOrder, type DiscountProvider } from "@/components/DiscountChoices/utils/options";
import { setMyCards, useMyCards } from "@/components/pages/SearchPage/utils/my-cards";
import { setDiscountsHref, type SearchUrl } from "@/components/pages/SearchPage/utils/search-href";
import { useDelayedApply } from "../utils/use-delayed-apply";
import { initialDiscountSelection, shouldSaveCards } from "./utils/initial";

type Props = {
  /** Proveedores con algún beneficio, en el orden de la config, con los tipos de tarjeta de sus beneficios: una fila por cada uno. */
  providers: DiscountProvider[];
  /** Lo elegido en `f` (`itau.credit`, sin `discount:`). */
  active: string[];
  state: SearchUrl;
};

/**
 * Descuentos: un panel con una fila por proveedor y sus chips (DiscountChoices); varios a la vez, en OR. Se aplica como
 * precio y dieta (useDelayedApply): al dejar de elegir o al cerrar, con una entrada al historial por apertura.
 * Sin descuentos en la URL, al abrir aparecen marcadas mis tarjetas, sin aplicarse; lo que se aplica (no vacío) pasa a
 * ser mis tarjetas.
 */
const DiscountFilter = (props: Props) => {
  const myCards = useMyCards();
  const { options } = discountRows(props.providers, props.active);
  // En el orden de las opciones, no en el de la URL.
  const active = inOptionOrder(options, props.active);
  const initial = initialDiscountSelection(
    active,
    myCards,
    options.map((option) => option.key),
  );
  const { open, selected, touched, onOpenChange, change } = useDelayedApply(active, (values) => setDiscountsHref(props.state, values), {
    initial,
    onApply: (values) => {
      if (shouldSaveCards(values)) setMyCards(values);
    },
  });

  // El botón muestra lo aplicado (o lo que se está por aplicar), no las tarjetas premarcadas sin tocar.
  const shown = touched ? selected : active;
  const only = shown.length === 1 ? options.find((option) => option.key === shown[0]) : undefined;
  const triggerLabel = only ? `${only.provider.name} · ${CARD_LABELS[only.card]}` : shown.length ? `Descuentos (${shown.length})` : "Descuentos";

  return (
    <Popover label="Descuentos" title="Descuentos con tarjeta" triggerLabel={triggerLabel} active={shown.length > 0} open={open} onOpenChange={onOpenChange}>
      <DiscountChoices providers={props.providers} selected={selected} keep={props.active} onChange={change} />
      {selected.length > 0 && <Button type="button" variant="tertiary" size="sm" label="Sacar descuentos" onClick={() => change([])} />}
    </Popover>
  );
};

export default DiscountFilter;
