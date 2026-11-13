"use client";

import { useHomeLocation } from "@/components/pages/SearchPage/utils/use-location";

/** No dibuja nada: con el permiso ya dado, mantiene al día la ubicación de "Abierto ahora cerca tuyo" (sin pedirlo). */
const HomeLocation = () => {
  useHomeLocation();
  return null;
};

export default HomeLocation;
