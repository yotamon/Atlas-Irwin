import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarketingProductPage } from "@/components/marketing/marketing-site";
import { pillars } from "@/lib/marketing-site/content";

const pages = [...pillars.map((p) => p.id), "about", "pricing"];
export const dynamicParams = false;
export function generateStaticParams() {
  return pages.map((page) => ({ page }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ page: string }>;
}): Promise<Metadata> {
  const { page } = await params;
  const pillar = pillars.find((p) => p.id === page);
  return {
    title:
      pillar?.label ?? (page === "about" ? "Our approach" : "Access & pricing"),
    description:
      pillar?.description ??
      "Learn about Ensemblis, the music-intelligence system built around your music.",
  };
}
export default async function ProductPage({
  params,
}: {
  params: Promise<{ page: string }>;
}) {
  const { page } = await params;
  if (!pages.includes(page)) notFound();
  return <MarketingProductPage page={page} />;
}
