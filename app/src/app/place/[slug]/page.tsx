import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { neighborhoodDisplayName } from "@shared/neighborhood-names.ts";
import PlacePage from "@/components/pages/PlacePage/PlacePage";
import { placeDescription, placeTitle } from "@/components/pages/PlacePage/utils/metadata";
import { getPublishedPlace } from "@/server/places/place";
import { SITE_NAME, withSiteName } from "@/lib/site";
import { placeOgImage } from "@/server/og/model";

export async function generateMetadata({ params }: PageProps<"/place/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const place = await getPublishedPlace(slug);
  if (!place) notFound();

  const neighborhood = neighborhoodDisplayName(place.neighborhood_id) ?? place.neighborhood_id;
  // "Ramona · Café en Buceo, Montevideo"; la pestaña termina en el sitio, como el resto (Open Graph lo lleva en siteName).
  const title = placeTitle(place, neighborhood);
  const description = placeDescription(place, neighborhood);
  const url = `/place/${place.slug}`;
  // Sólo datos propios (nunca lo de Google Places): el nombre, la categoría, el barrio, la descripción y la imagen para
  // compartir (banda + logo de R2, generada en og/[version]/route.tsx; absoluta por metadataBase).
  const image = placeOgImage({ slug: place.slug, name: place.name, logoKey: place.logo_key, logoBgColor: place.logo_bg_color });
  return {
    title: withSiteName(title),
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", locale: "es_UY", siteName: SITE_NAME, url, title, description, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function Place({ params }: PageProps<"/place/[slug]">) {
  return <PlacePage params={params} />;
}
