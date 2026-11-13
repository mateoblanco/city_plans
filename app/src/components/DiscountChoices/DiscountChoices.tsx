"use client";

import { Toggle } from "@base-ui/react/toggle";
import BankChip from "@/components/BankChip/BankChip";
import { CARD_LABELS, discountRows, inOptionOrder, type DiscountProvider } from "./utils/options";
import styles from "./DiscountChoices.module.scss";

type Props = {
  providers: DiscountProvider[];
  /** Lo marcado (`itau.credit`). */
  selected: string[];
  /** Tipos que conservan su chip aunque ya no tengan beneficios (lo elegido en la URL). */
  keep?: string[];
  /** La elección nueva, en el orden de las opciones. */
  onChange: (keys: string[]) => void;
};

/**
 * Una fila por proveedor (su nombre en BankChip, con el color del banco) con sus chips Débito y Crédito (sólo los que
 * tienen algún beneficio; "Cualquier tarjeta" cuenta como los dos). Varios a la vez. Lo usan el panel de Descuentos de
 * la barra y el paso de tarjetas de la bienvenida de la home.
 */
const DiscountChoices = (props: Props) => {
  const { rows, options } = discountRows(props.providers, props.keep);

  const toggle = (key: string, pressed: boolean) => {
    const next = pressed ? [...props.selected, key] : props.selected.filter((item) => item !== key);
    props.onChange(inOptionOrder(options, next));
  };

  return (
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
                  pressed={props.selected.includes(key)}
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
  );
};

export default DiscountChoices;
