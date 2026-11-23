"use client";

import { Select } from "@base-ui/react/select";
import Check from "@/assets/check.svg";
import ChevronDown from "@/assets/chevron_down.svg";
import styles from "./CitySelect.module.scss";

/** Ciudades del selector: por ahora sólo Montevideo; las demás se ven deshabilitadas con "Próximamente". */
const CITIES = [
  { value: "montevideo", label: "Montevideo", soon: false },
  { value: "maldonado", label: "Maldonado", soon: true },
  { value: "colonia", label: "Colonia", soon: true },
];

const CURRENT = CITIES[0];

/** Selector de ciudad del header, al lado del logo. Sólo hay una ciudad habilitada: elegirla no navega. */
const CitySelect = () => (
  <Select.Root items={CITIES} value={CURRENT.value}>
    <Select.Trigger className={styles.trigger} aria-label={`${CURRENT.label}, Ciudad`}>
      <Select.Value />
      <Select.Icon className={styles.triggerIcon}>
        <ChevronDown className={styles.icon} width={10} height={10} aria-hidden />
      </Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Positioner className={styles.positioner} sideOffset={4} alignItemWithTrigger={false} align="start">
        <Select.Popup className={styles.popup}>
          <Select.List className={styles.list}>
            {CITIES.map((city) => (
              <Select.Item key={city.value} value={city.value} disabled={city.soon} className={styles.item}>
                <Select.ItemText className={styles.itemText}>{city.label}</Select.ItemText>
                {city.soon && <span className={styles.soon}>Próximamente</span>}
                <Select.ItemIndicator className={styles.itemIndicator}>
                  <Check className={styles.icon} width={10} height={10} aria-hidden />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.List>
        </Select.Popup>
      </Select.Positioner>
    </Select.Portal>
  </Select.Root>
);

export default CitySelect;
