import type { Metadata } from "next";
import { notFound } from "next/navigation";
import GuidePage from "@/components/pages/GuidePage/GuidePage";
import { findGuide, guideParams } from "@/server/guides/catalog";
import { guideMetadata } from "@/server/guides/metadata";

// Las guías de barrio del archivo se prerenderizan en el build; su contenido se regenera al vencer la cache.
export async function generateStaticParams() {
  return guideParams();
}

export async function generateMetadata({ params }: PageProps<"/guides/montevideo/[segment]/[slug]">): Promise<Metadata> {
  const { segment, slug } = await params;
  const guide = findGuide(segment, slug);
  if (!guide) notFound();
  return guideMetadata(guide);
}

export default function NeighborhoodGuide({ params }: PageProps<"/guides/montevideo/[segment]/[slug]">) {
  return <GuidePage params={params} />;
}
