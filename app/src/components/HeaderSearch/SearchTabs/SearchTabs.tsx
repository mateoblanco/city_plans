import { Suspense } from "react";
import { searchPlaces } from "@/server/search";
import { emptyBar } from "@/server/search/intents";
import { isEmpty, readParams, toSearchOptions, toSearchUrl, type Params, type SearchParams } from "@/components/pages/SearchPage/utils/search-params";
import IntentTabs from "../IntentTabs/IntentTabs";
import { urlBar } from "../IntentTabs/utils/intent-tabs";

type ResolvedProps = {
  params: Params;
};

/** Con la búsqueda: su intención (la del texto también). Si falla, la de la URL. */
const ResolvedTabs = async (props: ResolvedProps) => {
  const response = await searchPlaces(props.params.query, toSearchOptions(props.params)).catch(() => null);
  return <IntentTabs state={toSearchUrl(props.params)} bar={response?.bar ?? urlBar(props.params.intent)} />;
};

type Props = {
  searchParams: SearchParams;
};

/**
 * Pestañas de /search con la intención de la búsqueda ("tomar algo en Palermo" activa Tomar algo). Apenas llegan los
 * parámetros muestra la intención de la URL; con la búsqueda (la misma de la barra y los resultados: searchPlaces está
 * deduplicada por request), la que entendió el servidor. Mismo alto en los tres estados: no corre nada.
 */
const SearchTabs = async (props: Props) => {
  const params = await readParams(props.searchParams);
  const state = toSearchUrl(params);
  if (isEmpty(params)) return <IntentTabs state={state} bar={emptyBar()} />;
  return (
    <Suspense fallback={<IntentTabs state={state} bar={urlBar(params.intent)} />}>
      <ResolvedTabs params={params} />
    </Suspense>
  );
};

export default SearchTabs;
