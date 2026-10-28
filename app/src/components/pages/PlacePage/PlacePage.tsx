import { Suspense } from "react";
import { notFound } from "next/navigation";
import { fetchPlaceDetails } from "@/server/places/google";
import { getPublishedPlace } from "@/server/places/place";

type DetailsProps = {
  params: Promise<{ slug: string }>;
};

// Lee el slug y la base dentro del Suspense (con cacheComponents son datos de request). Google se pide en cada
// request y no se guarda: si falla, el JSON de la base se muestra igual con un aviso en lugar del de Google.
const Details = async (props: DetailsProps) => {
  const { slug } = await props.params;
  const place = await getPublishedPlace(slug);
  if (!place) notFound();

  const google = await fetchPlaceDetails(place.google_place_id);

  return (
    <>
      <h1>{place.name}</h1>

      <h2>Base de datos</h2>
      <pre>{JSON.stringify(place, null, 2)}</pre>

      <h2>Google Places</h2>
      {google.ok ? (
        <pre>{JSON.stringify(google.data, null, 2)}</pre>
      ) : (
        <p role="alert">No pudimos traer los datos de Google: {google.error}</p>
      )}
    </>
  );
};

type Props = {
  params: Promise<{ slug: string }>;
};

const PlacePage = (props: Props) => {
  return (
    <section>
      <Suspense fallback={<p>Cargando…</p>}>
        <Details params={props.params} />
      </Suspense>
    </section>
  );
};

export default PlacePage;
