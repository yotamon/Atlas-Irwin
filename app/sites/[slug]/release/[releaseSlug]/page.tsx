import { notFound } from "next/navigation";
import { ReleaseSmartLink } from "@/components/sites/release-smart-link";
import { loadPublishedSiteBySlug } from "@/lib/sites/runtime";
import { loadSmartLinkRuntime } from "@/lib/smart-links/runtime";

export const dynamic = "force-dynamic";

export default async function ManagedReleaseSmartLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; releaseSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug, releaseSlug } = await params;
  const site = await loadPublishedSiteBySlug(slug);
  if (!site) notFound();
  const smartLink = await loadSmartLinkRuntime(site.site.id, releaseSlug);
  if (!smartLink || smartLink.link.artist_id !== site.site.artist_id) notFound();
  return <ReleaseSmartLink site={site} smartLink={smartLink} searchParams={await searchParams} />;
}
