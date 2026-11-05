"use client";

import FilterSelect from "../FilterSelect/FilterSelect";
import { dietSelection } from "./utils/diet-selection";
import { setDietsHref, type ChipRef, type SearchUrl } from "@/components/pages/SearchPage/utils/search-href";

type Props = {
  options: { id: string; label: string }[];
  /** Los chips de dieta de la búsqueda (del texto o de la barra): los activos y cómo se apagan. */
  chips: ChipRef[];
  state: SearchUrl;
};

/** Dieta: "Cualquier dieta" o Vegetariano / Vegano (se excluyen) y Sin TACC. Se suma a lo que pide el texto. */
const DietSelect = (props: Props) => (
  <FilterSelect
    label="Dieta"
    emptyLabel="Dieta"
    anyLabel="Cualquier dieta"
    options={props.options}
    chips={props.chips}
    hrefFor={(values, chips) => setDietsHref(props.state, values, chips)}
    normalize={dietSelection}
  />
);

export default DietSelect;
