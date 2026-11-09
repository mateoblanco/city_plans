import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { neighborhoodDisplayName } from "@shared/neighborhood-names.ts";
import PlacePage from "@/components/pages/PlacePage/PlacePage";
import { getPublishedPlace, metaDescription } from "@/server/places/place";
import { logoUrl } from "@/server/search/logo";

export async function generateMetadata({ params }: PageProps<"/place/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const place = await getPublishedPlace(slug);
  if (!place) notFound();

  const neighborhood = neighborhoodDisplayName(place.neighborhood_id) ?? place.neighborhood_id;
  const title = `${place.name} · ${neighborhood}`;
  const description = metaDescription(place.description_es);
  const url = `/place/${place.slug}`;
  // Sólo datos propios (nunca lo de Google Places): el nombre, la descripción y el logo de R2.
  const logo = logoUrl(place.logo_key);
  const images = logo ? [{ url: logo, alt: `Logo de ${place.name}` }] : undefined;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", locale: "es_UY", siteName: "Salimos", url, title, description, images },
    twitter: { card: "summary", title, description, images: logo ? [logo] : undefined },
  };
}

export default function Place({ params }: PageProps<"/place/[slug]">) {
  return <PlacePage params={params} />;
}
