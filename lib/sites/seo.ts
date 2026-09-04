import "server-only";

import type { Metadata } from "next";
import { getSiteUrl } from "@/lib/site-url";
import type { PublishedSiteRuntime } from "@/lib/sites/runtime";

export function getArtistSiteCanonicalUrl(runtime: PublishedSiteRuntime) {
  return runtime.primaryHostname
    ? `https://${runtime.primaryHostname}`
    : `${getSiteUrl()}/sites/${runtime.site.slug}`;
}

export function buildArtistSiteMetadata(runtime: PublishedSiteRuntime): Metadata {
  const canonical = getArtistSiteCanonicalUrl(runtime);
  const { seo, artist } = runtime.viewModel;

  return {
    title: seo.title,
    description: seo.description,
    alternates: { canonical },
    robots: { index: true, follow: true },
    authors: [{ name: artist.name, url: canonical }],
    creator: artist.name,
    publisher: artist.name,
    openGraph: {
      type: "website",
      url: canonical,
      siteName: artist.name,
      title: seo.title,
      description: seo.description,
      images: seo.imageUrl ? [seo.imageUrl] : undefined,
    },
    twitter: {
      card: seo.imageUrl ? "summary_large_image" : "summary",
      title: seo.title,
      description: seo.description,
      images: seo.imageUrl ? [seo.imageUrl] : undefined,
    },
  };
}

export function buildArtistSiteJsonLd(runtime: PublishedSiteRuntime) {
  const canonical = getArtistSiteCanonicalUrl(runtime);
  const { artist, releases, seo, socialLinks } = runtime.viewModel;
  const sameAs = socialLinks.map((link) => link.href);

  return [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: artist.name,
      url: canonical,
      description: seo.description,
      inLanguage: "en",
    },
    {
      "@context": "https://schema.org",
      "@type": "MusicGroup",
      name: artist.name,
      url: canonical,
      image: seo.imageUrl || undefined,
      sameAs: sameAs.length ? sameAs : undefined,
      album: releases.map((release) => ({
        "@type": "MusicAlbum",
        name: release.title,
        datePublished: release.releaseDate || undefined,
        image: release.artworkUrl || undefined,
        genre: release.genre || undefined,
        url: release.links[0]?.href || undefined,
      })),
    },
  ];
}
