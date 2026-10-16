"use client";

import { Select } from "@base-ui/react/select";
import { useRouter } from "next/navigation";
import styles from "./NeighborhoodSelect.module.scss";

const ALL = "Todos los barrios";

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
  /** Barrio activo (del texto o de la barra); "" si no hay. */
  value: string;
  /** URL de cada opción, armada en el server ("" = Todos). */
  hrefs: Record<string, string>;
};

/** Select de barrio de la barra: elegir uno navega a su URL (armada en el server). */
const NeighborhoodSelect = (props: Props) => {
  const router = useRouter();
  // items: Select.Value muestra el label del barrio elegido, no su id.
  const items = [{ value: "", label: ALL }, ...props.options.map((option) => ({ value: option.id, label: option.label }))];

  return (
    <Select.Root items={items} value={props.value} onValueChange={(next) => router.push(props.hrefs[next ?? ""])}>
      <Select.Trigger className={styles.trigger} aria-label="Barrio" data-active={props.value ? "" : undefined}>
        <Select.Value />
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
              {items.map((item) => (
                <Select.Item key={item.value} value={item.value} className={styles.item}>
                  <Select.ItemIndicator className={styles.itemIndicator}>
                    <CheckIcon />
                  </Select.ItemIndicator>
                  <Select.ItemText className={styles.itemText}>{item.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
            <Select.ScrollDownArrow className={styles.scrollArrow}>
              <CaretDownIcon />
            </Select.ScrollDownArrow>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
};

export default NeighborhoodSelect;
