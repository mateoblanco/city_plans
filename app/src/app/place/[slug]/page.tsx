import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { neighborhoodDisplayName } from "@shared/neighborhood-names.ts";
import PlacePage from "@/components/pages/PlacePage/PlacePage";
import { placeDescription, placeTitle } from "@/components/pages/PlacePage/utils/metadata";
import { getPublishedPlace } from "@/server/places/place";
import { logoUrl } from "@/server/search/logo";
import { SITE_NAME, withSiteName } from "@/lib/site";

export async function generateMetadata({ params }: PageProps<"/place/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const place = await getPublishedPlace(slug);
  if (!place) notFound();

  const neighborhood = neighborhoodDisplayName(place.neighborhood_id) ?? place.neighborhood_id;
  // "Ramona · Café en Buceo, Montevideo"; la pestaña termina en el sitio, como el resto (Open Graph lo lleva en siteName).
  const title = placeTitle(place, neighborhood);
  const description = placeDescription(place, neighborhood);
  const url = `/place/${place.slug}`;
  // Sólo datos propios (nunca lo de Google Places): el nombre, la categoría, el barrio, la descripción y el logo de R2.
  const logo = logoUrl(place.logo_key);
  const images = logo ? [{ url: logo, alt: `Logo de ${place.name}` }] : undefined;
  return {
    title: withSiteName(title),
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", locale: "es_UY", siteName: SITE_NAME, url, title, description, images },
    twitter: { card: "summary", title, description, images: logo ? [logo] : undefined },
  };
}

export default function Place({ params }: PageProps<"/place/[slug]">) {
  return <PlacePage params={params} />;
}
