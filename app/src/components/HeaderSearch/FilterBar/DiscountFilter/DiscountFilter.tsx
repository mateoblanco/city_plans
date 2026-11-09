"use client";

import { Toggle } from "@base-ui/react/toggle";
import BankChip from "@/components/BankChip/BankChip";
import Button from "@/components/base/Button/Button";
import Popover from "@/components/base/Popover/Popover";
import { setDiscountsHref, type SearchUrl } from "@/components/pages/SearchPage/utils/search-href";
import { availableCards, type DiscountCard } from "@/lib/discount-cards";
import { useDelayedApply } from "../utils/use-delayed-apply";
import styles from "./DiscountFilter.module.scss";

const CARD_LABELS: Record<DiscountCard, string> = { debit: "Débito", credit: "Crédito" };

type Props = {
  /** Proveedores con algún beneficio, en el orden de la config, con los tipos de tarjeta de sus beneficios: una fila por cada uno. */
  providers: { id: string; name: string; cardTypes: string[] }[];
  /** Lo elegido en `f` (`itau.credit`, sin `discount:`). */
  active: string[];
  state: SearchUrl;
};

/**
 * Descuentos: un panel con una fila por proveedor (su nombre en BankChip, con el color del banco) y sus chips (Débito, Crédito: sólo los que tienen algún beneficio,
 * con "Cualquier tarjeta" como los dos; Itaú, sin débito, sólo Crédito); varios a la vez, en OR. Se aplica como
 * precio y dieta (useDelayedApply): al dejar de elegir o al cerrar, con una entrada al historial por apertura.
 */
const DiscountFilter = (props: Props) => {
  // Un tipo sin beneficios no tiene chip, salvo que ya esté elegido en la URL (así se puede sacar).
  const chosen = (provider: { id: string }) => props.active.flatMap((key) => (key.startsWith(`${provider.id}.`) ? [key.slice(provider.id.length + 1) as DiscountCard] : []));
  const rows = props.providers.map((provider) => ({ provider, cards: availableCards(provider.cardTypes, chosen(provider)) }));
  const options = rows.flatMap(({ provider, cards }) => cards.map((card) => ({ key: `${provider.id}.${card}`, provider, card })));
  // En el orden de las opciones, no en el de la URL.
  const active = options.map((option) => option.key).filter((key) => props.active.includes(key));
  const { open, selected, onOpenChange, change } = useDelayedApply(active, (values) => setDiscountsHref(props.state, values));

  const toggle = (key: string, pressed: boolean) => {
    const next = pressed ? [...selected, key] : selected.filter((item) => item !== key);
    change(options.map((option) => option.key).filter((item) => next.includes(item)));
  };

  const only = selected.length === 1 ? options.find((option) => option.key === selected[0]) : undefined;
  const triggerLabel = only ? `${only.provider.name} · ${CARD_LABELS[only.card]}` : selected.length ? `Descuentos (${selected.length})` : "Descuentos";

  return (
    <Popover label="Descuentos" title="Descuentos con tarjeta" triggerLabel={triggerLabel} active={selected.length > 0} open={open} onOpenChange={onOpenChange}>
      <ul className={styles.rows}>
        {rows.map(({ provider, cards }) => (
          <li key={provider.id} className={styles.row}>
            <BankChip id={provider.id} name={provider.name} />
            <span className={styles.cards}>
              {cards.map((card) => {
                const key = `${provider.id}.${card}`;
                return (
                  <Toggle
                    key={card}
                    className={styles.chip}
                    pressed={selected.includes(key)}
                    onPressedChange={(pressed) => toggle(key, pressed)}
                    aria-label={`${provider.name} · ${CARD_LABELS[card]}`}
                  >
                    {CARD_LABELS[card]}
                  </Toggle>
                );
              })}
            </span>
          </li>
        ))}
      </ul>
      {selected.length > 0 && <Button type="button" variant="tertiary" size="sm" label="Sacar descuentos" onClick={() => change([])} />}
    </Popover>
  );
};

export default DiscountFilter;
