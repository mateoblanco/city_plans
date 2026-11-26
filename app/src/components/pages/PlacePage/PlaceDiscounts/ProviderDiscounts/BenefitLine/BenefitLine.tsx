import Link from "@/components/base/Link/Link";
import Tooltip from "@/components/base/Tooltip/Tooltip";
import type { PlaceBenefit } from "@/server/discounts";
import { benefitCap, benefitLine } from "../../../utils/discounts";
import { trackAttrs } from "@/lib/product-analytics/track";
import styles from "./BenefitLine.module.scss";

type Props = {
  benefit: PlaceBenefit;
  /** Los tipos de tarjeta de la línea (varios si se juntaron: "Débito y crédito"). */
  cardTypes: PlaceBenefit["cardType"][];
  /** Para la analítica de producto: "Ver más info" cuenta como discount_info_clicked de ese banco. */
  analytics: { id: string; slug: string; bank: string };
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
          <Link
            href={props.benefit.sourceUrl}
            external
            label="Ver más info"
            analytics={trackAttrs("discount_info_clicked", { place_id: props.analytics.id, slug: props.analytics.slug, bank: props.analytics.bank })}
          />
        </>
      )}
    </li>
  );
};

export default BenefitLine;
