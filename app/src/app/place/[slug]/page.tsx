import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { neighborhoodDisplayName } from "@shared/neighborhood-names.ts";
import PlacePage from "@/components/pages/PlacePage/PlacePage";
import { getPublishedPlace, metaDescription } from "@/server/places/place";

export async function generateMetadata({ params }: PageProps<"/place/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const place = await getPublishedPlace(slug);
  if (!place) notFound();

  const neighborhood = neighborhoodDisplayName(place.neighborhood_id) ?? place.neighborhood_id;
  return {
    title: `${place.name} · ${neighborhood}`,
    description: metaDescription(place.description_es),
    alternates: { canonical: `/place/${place.slug}` },
  };
}

export default function Place({ params }: PageProps<"/place/[slug]">) {
  return <PlacePage params={params} />;
}
