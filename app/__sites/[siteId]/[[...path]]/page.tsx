import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { loadPublishedSiteByHostname } from "@/lib/sites/runtime";
import { buildArtistSiteJsonLd, buildArtistSiteMetadata } from "@/lib/sites/seo";
import { getSiteTemplate } from "@/lib/sites/templates/registry";

type PageProps = {
  params: Promise<{ siteId: string; path?: string[] }>;
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
  if (path.length) return { robots: { index: false, follow: false } };
  const runtime = await resolveTrustedRuntime(siteId);
  if (!runtime) return { robots: { index: false, follow: false } };
  return buildArtistSiteMetadata(runtime);
}

export default async function InternalArtistSitePage({ params }: PageProps) {
  const { siteId, path = [] } = await params;
  // v1 intentionally exposes only the canonical artist homepage. Future landing,
  // EPK and campaign routes will extend the same runtime rather than falling back
  // to another artist's global routes.
  if (path.length) notFound();

  const runtime = await resolveTrustedRuntime(siteId);
  if (!runtime) notFound();

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
