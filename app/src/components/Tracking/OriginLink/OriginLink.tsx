"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { EventOrigin } from "@shared/events.ts";
import { markOrigin } from "../utils/track";

type Props = {
  slug: string;
  origin: EventOrigin;
  /** Id de la fila de la home. */
  row?: string | null;
  className?: string;
  children: ReactNode;
};

/**
 * Link a una ficha que recuerda (en memoria) de dónde vino el click, para la vista de esa ficha. La URL no cambia y el
 * prefetch es el de siempre (no se puede cambiar desde acá: ver google-cost-guard.test.ts).
 */
const OriginLink = (props: Props) => (
  <Link
    href={`/place/${props.slug}`}
    className={props.className}
    onClick={() => markOrigin(props.slug, { origin: props.origin, row: props.row ?? null })}
  >
    {props.children}
  </Link>
);

export default OriginLink;
