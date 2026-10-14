"use client";

import { useRouter } from "next/navigation";

type NeighborhoodSelectProps = {
  options: { id: string; label: string }[];
  /** Barrio activo (del texto o de la barra); "" si no hay. */
  value: string;
  /** URL de cada opción, armada en el server ("" = Todos). */
  hrefs: Record<string, string>;
};

const NeighborhoodSelect = ({ options, value, hrefs }: NeighborhoodSelectProps) => {
  const router = useRouter();
  return (
    <select aria-label="Barrio" value={value} onChange={(event) => router.push(hrefs[event.target.value])}>
      <option value="">Todos los barrios</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
};

export default NeighborhoodSelect;
