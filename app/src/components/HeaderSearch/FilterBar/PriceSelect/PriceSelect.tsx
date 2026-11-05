"use client";

import FilterSelect from "../FilterSelect/FilterSelect";
import { setPricesHref, type ChipRef, type SearchUrl } from "@/components/pages/SearchPage/utils/search-href";

type Props = {
  options: { id: string; label: string }[];
  /** Los chips de precio de la búsqueda (del texto o de la barra): los activos y cómo se apagan. */
  chips: ChipRef[];
  state: SearchUrl;
};

/** Precio: "Cualquier precio" o varios niveles. */
const PriceSelect = (props: Props) => (
  <FilterSelect
    label="Precio"
    emptyLabel="Precio"
    anyLabel="Cualquier precio"
    options={props.options}
    chips={props.chips}
    hrefFor={(values, chips) => setPricesHref(props.state, values, chips)}
  />
);

export default PriceSelect;
