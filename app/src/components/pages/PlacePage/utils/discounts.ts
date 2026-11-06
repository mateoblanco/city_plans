import type { Weekday } from "@shared/discounts.ts";
import type { PlaceBenefit } from "@/server/discounts";

const CARD_LABELS: Record<PlaceBenefit["cardType"], string> = { debit: "Débito", credit: "Crédito", other: "Cualquier tarjeta" };

const DAY_NAMES: Record<Weekday, string> = { mon: "lunes", tue: "martes", wed: "miércoles", thu: "jueves", fri: "viernes", sat: "sábado", sun: "domingo" };
const DAY_ORDER = Object.keys(DAY_NAMES) as Weekday[];

const percent = (value: number) => `${value.toLocaleString("es-UY", { maximumFractionDigits: 1 })}%`;

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase("es") + text.slice(1);

/** "Platinum, Select y Private Banking". */
export function spanishList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

type CardType = PlaceBenefit["cardType"];

/** "Débito", "Crédito", "Débito y crédito"; con "other" (sin especificar), "Cualquier tarjeta". */
function cardLabel(cardTypes: CardType[]): string {
  if (cardTypes.includes("other")) return CARD_LABELS.other;
  const labels = (["debit", "credit"] as const).filter((type) => cardTypes.includes(type)).map((type) => CARD_LABELS[type]);
  return capitalize(spanishList(labels.map((label, index) => (index === 0 ? label : label.toLocaleLowerCase("es")))));
}

/**
 * "25% · Crédito Platinum, Select y Private Banking"; con tarjeta co-branded, " · Tarjeta Nacional". cardTypes: los tipos
 * de la línea (varios si se juntaron, "25% · Débito y crédito").
 */
export function benefitHeadline(benefit: PlaceBenefit, cardTypes: CardType[] = [benefit.cardType]): string {
  const card = [cardLabel(cardTypes), spanishList(benefit.cardTiers)].filter(Boolean).join(" ");
  return [percent(benefit.percent), card, benefit.cardProgram ? `Tarjeta ${benefit.cardProgram}` : null].filter(Boolean).join(" · ");
}

/** Los días, sólo si no es todos los días: "Lunes, miércoles y viernes"; sin dato, el texto de la fuente (si hay). */
export function benefitDays(benefit: PlaceBenefit): string | null {
  if (benefit.days === "all") return null;
  if (benefit.days === null) {
    const text = benefit.daysText?.trim();
    return text && !/^todos los d[ií]as$/i.test(text) ? capitalize(text) : null;
  }
  const days = DAY_ORDER.filter((day) => (benefit.days as Weekday[]).includes(day));
  if (days.length === 0 || days.length === DAY_ORDER.length) return null;
  return capitalize(spanishList(days.map((day) => DAY_NAMES[day])));
}

/**
 * "reintegro" o "10% en el momento + 10% de reintegro". En el momento es lo habitual y no se muestra; null también si no
 * se sabe.
 */
export function benefitMode(benefit: PlaceBenefit): string | null {
  if (benefit.mode === "refund") return "reintegro";
  if (benefit.mode === "mixed") {
    return benefit.instantPercent !== null && benefit.refundPercent !== null
      ? `${percent(benefit.instantPercent)} en el momento + ${percent(benefit.refundPercent)} de reintegro`
      : "parte en el momento y parte de reintegro";
  }
  return null;
}

/** La línea del beneficio: porcentaje y tarjeta, días (si no son todos) y modalidad. */
export function benefitLine(benefit: PlaceBenefit, cardTypes: CardType[] = [benefit.cardType]): string {
  return [benefitHeadline(benefit, cardTypes), benefitDays(benefit), benefitMode(benefit)].filter(Boolean).join(" · ");
}

/** Una línea de la ficha: un beneficio y los tipos de tarjeta que junta (los demás datos son iguales). */
export type BenefitRow = { key: string; benefit: PlaceBenefit; cardTypes: CardType[] };

/** Todo lo que se muestra de un beneficio salvo el tipo de tarjeta (los niveles, sin importar el orden). */
const sameExceptCard = (benefit: PlaceBenefit) =>
  JSON.stringify([
    benefit.percent,
    [...benefit.cardTiers].sort(),
    benefit.cardProgram,
    benefit.mode,
    benefit.instantPercent,
    benefit.refundPercent,
    benefit.days,
    benefit.daysText,
    benefit.cap?.text ?? null,
    benefit.sourceUrl,
  ]);

/**
 * Las líneas de un proveedor: los beneficios que sólo difieren en el tipo de tarjeta (mismo porcentaje, niveles,
 * programa, modalidad, días, tope y página de origen) van en una ("25% · Débito y crédito"); con otros niveles, aparte.
 * En el orden en que vienen, cada línea donde estaba el primero.
 */
export function benefitRows(benefits: PlaceBenefit[]): BenefitRow[] {
  const rows = new Map<string, BenefitRow>();
  for (const benefit of benefits) {
    const key = sameExceptCard(benefit);
    const row = rows.get(key);
    if (row) {
      if (!row.cardTypes.includes(benefit.cardType)) row.cardTypes.push(benefit.cardType);
    } else rows.set(key, { key: benefit.id, benefit, cardTypes: [benefit.cardType] });
  }
  return [...rows.values()];
}

/** El texto del tope para el tooltip; null sin tope (o si la fuente dice "Sin tope"). */
export function benefitCap(benefit: PlaceBenefit): string | null {
  const text = benefit.cap?.text.trim();
  return text && !/^sin tope\b/i.test(text) ? text : null;
}
