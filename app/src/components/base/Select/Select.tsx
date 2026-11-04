"use client";

import { Select as SelectBase } from "@base-ui/react/select";
import Check from "@/assets/check.svg";
import ChevronDown from "@/assets/chevron_down.svg";
import styles from "./Select.module.scss";

type Props = {
  /** Nombre accesible del botón (aria-label). */
  label: string;
  items: { value: string; label: string }[];
  value: string[];
  onValueChange: (value: string[]) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Texto del botón (lo que va dentro de Select.Value). */
  triggerLabel: () => React.ReactNode;
  /** El botón se ve elegido (data-active), como los chips de la barra. */
  active: boolean;
  /** Valor del ítem después del cual va un separador. */
  separatorAfter?: string;
};

/** Select de varias opciones (siempre `multiple`) con el botón de los filtros de la barra; se abre debajo. */
const Select = (props: Props) => (
  <SelectBase.Root multiple items={props.items} value={props.value} onValueChange={props.onValueChange} open={props.open} onOpenChange={props.onOpenChange} >
    <SelectBase.Trigger className={styles.trigger} aria-label={props.label} data-active={props.active ? "" : undefined}>
      <SelectBase.Value>{props.triggerLabel}</SelectBase.Value>
      <SelectBase.Icon className={styles.triggerIcon}>
        <ChevronDown className={styles.icon} width={10} height={10} aria-hidden />
      </SelectBase.Icon>
    </SelectBase.Trigger>
    <SelectBase.Portal>
      {/* alignItemWithTrigger={false}: se abre debajo, como "Más filtros", en vez de encima del botón. */}
      <SelectBase.Positioner className={styles.positioner} sideOffset={4} alignItemWithTrigger={false} align="start">
        <SelectBase.Popup className={styles.popup}>
          
          <SelectBase.List className={styles.list}>
            {props.items.map((item) => [
              <SelectBase.Item key={item.value} value={item.value} className={styles.item}>
                <SelectBase.ItemIndicator className={styles.itemIndicator}>
                  <Check className={styles.icon} width={10} height={10} aria-hidden />
                </SelectBase.ItemIndicator>
                <SelectBase.ItemText className={styles.itemText}>{item.label}</SelectBase.ItemText>
              </SelectBase.Item>,
              props.separatorAfter !== undefined && item.value === props.separatorAfter && <SelectBase.Separator key="separator" className={styles.separator} />,
            ])}
          </SelectBase.List>
         
        </SelectBase.Popup>
      </SelectBase.Positioner>
    </SelectBase.Portal>
  </SelectBase.Root>
);

export default Select;
