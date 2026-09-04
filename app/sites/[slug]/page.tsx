import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPublishedSiteBySlug } from "@/lib/sites/runtime";
import { getSiteTemplate } from "@/lib/sites/templates/registry";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const runtime = await loadPublishedSiteBySlug(slug);
  if (!runtime) return { title: "Artist site" };

  return {
    title: runtime.viewModel.seo.title,
    description: runtime.viewModel.seo.description,
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      title: runtime.viewModel.seo.title,
      description: runtime.viewModel.seo.description,
      images: runtime.viewModel.seo.imageUrl ? [runtime.viewModel.seo.imageUrl] : undefined,
    },
  };
}

export default async function PublishedArtistSitePage({ params }: PageProps) {
  const { slug } = await params;
  const runtime = await loadPublishedSiteBySlug(slug);
  if (!runtime) notFound();

  const template = getSiteTemplate(runtime.site.template_key);
  const Template = template.render;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "MusicGroup",
    name: runtime.viewModel.artist.name,
    url: `/sites/${runtime.site.slug}`,
    image: runtime.viewModel.seo.imageUrl || undefined,
    album: runtime.viewModel.releases.map((release) => ({
      "@type": "MusicAlbum",
      name: release.title,
      datePublished: release.releaseDate || undefined,
      image: release.artworkUrl || undefined,
    })),
  };

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
