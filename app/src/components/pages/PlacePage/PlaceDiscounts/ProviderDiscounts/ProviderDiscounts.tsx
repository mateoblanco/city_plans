import BankChip from "@/components/BankChip/BankChip";
import type { PlaceBenefit } from "@/server/discounts";
import { benefitRows } from "../../utils/discounts";
import BenefitLine from "./BenefitLine/BenefitLine";
import styles from "./ProviderDiscounts.module.scss";

type Props = {
  /** Id del proveedor: elige el color de marca del chip del nombre (data-provider). */
  id: string;
  name: string;
  benefits: PlaceBenefit[];
};

/**
 * Un proveedor dentro de la card de descuentos: su nombre en un chip con el color del banco y sus beneficios, uno por
 * línea (los que sólo difieren en el tipo de tarjeta, juntos: benefitRows).
 */
const ProviderDiscounts = (props: Props) => (
  <div className={styles.provider}>
    <h3 className={styles.name}>
      <BankChip id={props.id} name={props.name} />
    </h3>
    <ul className={styles.benefits}>
      {benefitRows(props.benefits).map((row) => (
        <BenefitLine key={row.key} benefit={row.benefit} cardTypes={row.cardTypes} />
      ))}
    </ul>
  </div>
);

export default ProviderDiscounts;
