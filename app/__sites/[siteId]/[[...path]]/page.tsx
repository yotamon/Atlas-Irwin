import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ReleaseSmartLink } from "@/components/sites/release-smart-link";
import { loadPublishedSiteByHostname } from "@/lib/sites/runtime";
import { buildArtistSiteJsonLd, buildArtistSiteMetadata } from "@/lib/sites/seo";
import { getSiteTemplate } from "@/lib/sites/templates/registry";
import { loadSmartLinkRuntime } from "@/lib/smart-links/runtime";

type PageProps = {
  params: Promise<{ siteId: string; path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function resolveTrustedRuntime(siteId: string) {
  const requestHeaders = await headers();
  const trustedSiteId = requestHeaders.get("x-ensemblis-site-id");
  const trustedHostname = requestHeaders.get("x-ensemblis-site-host");
  if (!trustedHostname || trustedSiteId !== siteId) return null;

  const runtime = await loadPublishedSiteByHostname(trustedHostname);
  if (!runtime || runtime.site.id !== siteId) return null;
  return runtime;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { siteId, path = [] } = await params;
  const runtime = await resolveTrustedRuntime(siteId);
  if (!runtime) return { robots: { index: false, follow: false } };
  if (path.length === 2 && path[0] === "release") {
    const smartLink = await loadSmartLinkRuntime(siteId, path[1]);
    if (!smartLink) return { robots: { index: false, follow: false } };
    return {
      title: `${smartLink.release.title} · ${runtime.viewModel.artist.name}`,
      description: smartLink.mode === "pre_release" ? `Pre-save ${smartLink.release.title}.` : `Listen to ${smartLink.release.title}.`,
      openGraph: { images: smartLink.release.artwork_url ? [smartLink.release.artwork_url] : undefined },
    };
  }
  if (path.length) return { robots: { index: false, follow: false } };
  return buildArtistSiteMetadata(runtime);
}

export default async function InternalArtistSitePage({ params, searchParams }: PageProps) {
  const { siteId, path = [] } = await params;
  const runtime = await resolveTrustedRuntime(siteId);
  if (!runtime) notFound();

  if (path.length === 2 && path[0] === "release") {
    const smartLink = await loadSmartLinkRuntime(siteId, path[1]);
    if (!smartLink || smartLink.link.artist_id !== runtime.site.artist_id) notFound();
    return <ReleaseSmartLink site={runtime} smartLink={smartLink} searchParams={await searchParams} />;
  }
  if (path.length) notFound();

  const definition = getSiteTemplate(
    runtime.version.template_key,
    runtime.version.template_version,
  );
  const Template = definition.render;
  const structuredData = buildArtistSiteJsonLd(runtime);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <Template config={runtime.config} viewModel={runtime.viewModel} />
    </>
  );
}