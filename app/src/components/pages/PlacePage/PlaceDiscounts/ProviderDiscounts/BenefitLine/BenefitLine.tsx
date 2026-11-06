import Link from "@/components/base/Link/Link";
import Tooltip from "@/components/base/Tooltip/Tooltip";
import type { PlaceBenefit } from "@/server/discounts";
import { benefitCap, benefitLine } from "../../../utils/discounts";
import styles from "./BenefitLine.module.scss";

type Props = {
  benefit: PlaceBenefit;
  /** Los tipos de tarjeta de la línea (varios si se juntaron: "Débito y crédito"). */
  cardTypes: PlaceBenefit["cardType"][];
};

/** Un beneficio en una línea: "15% · Crédito · Con tope – Ver más info" (el tope en un tooltip, el link al banco). */
const BenefitLine = (props: Props) => {
  const cap = benefitCap(props.benefit);

  return (
    <li className={styles.benefit}>
      <span>{benefitLine(props.benefit, props.cardTypes)}</span>
      {cap && (
        <>
          <span aria-hidden>·</span>
          <Tooltip trigger="Con tope">{cap}</Tooltip>
        </>
      )}
      {props.benefit.sourceUrl && (
        <>
          <span aria-hidden>–</span>
          <Link href={props.benefit.sourceUrl} external label="Ver más info" />
        </>
      )}
    </li>
  );
};

export default BenefitLine;
