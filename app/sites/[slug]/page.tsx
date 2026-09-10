import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPublishedSiteBySlug } from "@/lib/sites/runtime";
import { buildArtistSiteJsonLd, buildArtistSiteMetadata } from "@/lib/sites/seo";
import { getSiteTemplate } from "@/lib/sites/templates/registry";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const runtime = await loadPublishedSiteBySlug(slug);
  if (!runtime) return { title: "Artist site", robots: { index: false, follow: false } };
  return buildArtistSiteMetadata(runtime);
}

export default async function PublishedArtistSitePage({ params }: PageProps) {
  const { slug } = await params;
  const runtime = await loadPublishedSiteBySlug(slug);
  if (!runtime) notFound();

  const template = getSiteTemplate(runtime.version.template_key, runtime.version.template_version);
  const Template = template.render;
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
