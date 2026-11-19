"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { EMPTY, PENDING, PlaceGoogleContext, type PlaceGoogleState } from "./utils/context";
import { loadPlaceGoogle } from "./utils/load";

type Props = {
  placeId: string;
  /** El lugar tiene google_place_id: sin él no se pide nada y las partes de Google no reservan lugar. */
  enabled: boolean;
  children: ReactNode;
};

const fetchFn = (input: string, init: RequestInit) => fetch(input, init);

/**
 * Lo de Google de la ficha, pedido desde el navegador una vez por vista (loadPlaceGoogle, en un efecto: nunca en el
 * render del servidor ni en el prefetch) y repartido por contexto a las partes que lo muestran (puntaje, estado,
 * dirección, contacto y horarios). PlacePage lo monta con key = id del lugar: otra ficha empieza de cero.
 */
const PlaceGoogle = (props: Props) => {
  const [state, setState] = useState<PlaceGoogleState>(props.enabled ? PENDING : EMPTY);
  const started = useRef(false);

  useEffect(() => {
    if (!props.enabled) return;
    return loadPlaceGoogle(props.placeId, started, (info) => setState(info ? { status: "ready", info } : EMPTY), { fetchFn, doc: document });
  }, [props.placeId, props.enabled]);

  return <PlaceGoogleContext value={state}>{props.children}</PlaceGoogleContext>;
};

export default PlaceGoogle;
