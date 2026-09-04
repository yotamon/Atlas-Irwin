import type { ReactNode } from "react";

import { AboutSection } from "@/components/about-section";
import { ContactSection } from "@/components/contact-section";
import { Footer } from "@/components/footer";
import { HashScrollRestorer } from "@/components/hash-scroll-restorer";
import { Hero } from "@/components/hero";
import { ListenPlatformsSection } from "@/components/listen-platforms-section";
import { Navbar } from "@/components/navbar";
import { NewsletterSignup } from "@/components/newsletter-signup";
import { ReleaseWidgetClient } from "@/components/release-widget-client";
import {
  formatDurationSeconds,
  formatReleaseDateLabel,
  formatTotalDurationLabel,
} from "@/lib/catalog/format";
import type {
  ArtistSiteConfig,
  SiteReleaseCard,
  SiteSectionKey,
  SiteViewModel,
} from "@/types/ensemblis-sites";

type Props = {
  config: ArtistSiteConfig;
  viewModel: SiteViewModel;
  preview?: boolean;
};

function playableReleaseView(release: SiteReleaseCard, artistName: string) {
  const playableTracks = (release.tracks ?? [])
    .filter((track) => Boolean(track.soundcloudUrl || track.audioUrl))
    .sort((left, right) => left.displayOrder - right.displayOrder || (left.trackNumber ?? 999) - (right.trackNumber ?? 999));

  if (!playableTracks.length) return null;
  const hasPrimary = playableTracks.some((track) => track.isPrimary);

  const tracks = playableTracks.map((track, index) => ({
    number: String(track.trackNumber ?? index + 1).padStart(2, "0"),
    title: track.title,
    duration: track.durationSeconds === null ? undefined : formatDurationSeconds(track.durationSeconds),
    file: track.audioUrl || track.soundcloudUrl || track.title,
    url: track.soundcloudUrl || track.audioUrl || "",
    source: track.soundcloudUrl ? ("soundcloud" as const) : ("local" as const),
    active: hasPrimary ? track.isPrimary : index === 0,
    links: track.spotifyUrl
      ? [{ platform: "Spotify", href: track.spotifyUrl, label: "Spotify" }]
      : [],
  }));

  return {
    slug: release.slug,
    title: release.title,
    type: release.releaseType,
    artist: artistName,
    coverUrl: release.artworkUrl || "/site-cover-placeholder.svg",
    coverAlt: `${release.title} cover art`,
    releaseDateLabel: formatReleaseDateLabel(release.releaseDate),
    trackCount: tracks.length,
    totalDurationLabel: formatTotalDurationLabel(
      playableTracks.map((track) => track.durationSeconds),
    ),
    tracks,
  };
}

function ReleaseFallback({ releases }: { releases: SiteReleaseCard[] }) {
  if (!releases.length) return null;

  return (
    <section
      id="release-widget"
      className="relative -top-19 z-30 mx-auto -mb-19 w-full max-w-295 scroll-mt-32 px-5 pb-2 sm:-top-25 sm:-mb-25 sm:px-8 lg:px-0"
    >
      <div className="paper-card rounded-[1.45rem] border border-ink/35 p-5 shadow-[0_18px_42px_rgba(17,17,17,0.1)] sm:rounded-[1.85rem] sm:p-7">
        <p className="section-kicker">Music</p>
        <h2 className="section-title mt-3">Latest Releases</h2>
        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {releases.slice(0, 6).map((release) => (
            <article key={release.id} className="rounded-[1.2rem] border border-line bg-surface-soft p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={release.artworkUrl || "/site-cover-placeholder.svg"}
                alt={`${release.title} cover art`}
                className="aspect-square w-full rounded-[0.9rem] object-cover"
                loading="lazy"
              />
              <p className="mt-4 font-display text-[0.9rem] uppercase tracking-[0.16em] text-muted">
                {release.releaseType}
              </p>
              <h3 className="mt-1 font-display text-[1.8rem] uppercase leading-none text-ink">
                {release.title}
              </h3>
              <div className="mt-4 flex flex-wrap gap-3">
                {release.links.slice(0, 4).map((link) => (
                  <a
                    key={`${release.id}-${link.href}`}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="font-display text-[0.82rem] uppercase tracking-[0.13em] text-teal hover:text-coral"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function renderSection(section: SiteSectionKey, props: Props): ReactNode {
  const { config, viewModel } = props;
  const content = config.retrofuture ?? {};
  if (config.hiddenSections.includes(section)) return null;

  const platformLinks = content.platformLinks?.length
    ? content.platformLinks
    : viewModel.socialLinks;

  if (section === "hero") {
    return (
      <Hero
        key={section}
        artistName={viewModel.artist.name}
        taglines={content.heroTaglines}
        primaryCtaLabel={content.primaryCtaLabel || "Listen now"}
        primaryCtaHref={content.primaryCtaHref || "#release-widget"}
        secondaryCtaLabel={content.secondaryCtaLabel || "Contact"}
        secondaryCtaHref={content.secondaryCtaHref || "#contact"}
      />
    );
  }

  if (section === "releases") {
    const playable = viewModel.releases
      .map((release) => playableReleaseView(release, viewModel.artist.name))
      .filter((release): release is NonNullable<typeof release> => Boolean(release));

    return playable.length
      ? <ReleaseWidgetClient key={section} releases={playable} />
      : <ReleaseFallback key={section} releases={viewModel.releases} />;
  }

  if ((section === "platforms" || section === "links") && platformLinks.length) {
    return (
      <ListenPlatformsSection
        key={section}
        heading={content.listenHeading || "Listen Everywhere"}
        links={platformLinks}
      />
    );
  }

  if (section === "about") {
    const paragraphs = content.aboutParagraphs?.length
      ? content.aboutParagraphs
      : viewModel.artist.bio
        ? [viewModel.artist.bio]
        : [viewModel.seo.description];

    return (
      <AboutSection
        key={section}
        artistName={viewModel.artist.name}
        heading={content.aboutHeading || viewModel.artist.name}
        paragraphs={paragraphs}
        imageUrl={content.aboutImageUrl || viewModel.artist.avatarUrl}
        imageAlt={content.aboutImageAlt}
        capabilities={content.capabilities || []}
        values={content.values || []}
      />
    );
  }

  if (section === "contact") {
    const email = content.contactEmail || viewModel.contact.email;
    const formEnabled = Boolean(content.contactFormEnabled && content.contactFormEndpoint);
    return (
      <ContactSection
        key={section}
        email={email}
        heading={content.contactHeading || "Let's Talk"}
        copy={content.contactCopy || `For bookings, collaborations, and project enquiries, get in touch with ${viewModel.artist.name}.`}
        formEnabled={formEnabled}
        formEndpoint={content.contactFormEndpoint}
        formContext={{ artistId: viewModel.artist.id }}
      />
    );
  }

  if (section === "newsletter" && content.newsletterEnabled && content.newsletterEndpoint) {
    return (
      <NewsletterSignup
        key={section}
        endpoint={content.newsletterEndpoint}
        context={{ artistId: viewModel.artist.id }}
        kicker={content.newsletterKicker}
        heading={content.newsletterHeading}
        copy={content.newsletterCopy}
      />
    );
  }

  return null;
}

export function EditorialRetrofutureTemplate(props: Props) {
  const { config, viewModel, preview } = props;
  const content = config.retrofuture ?? {};
  const platformLinks = content.platformLinks?.length
    ? content.platformLinks
    : viewModel.socialLinks;
  const visibleSections = new Set(
    config.sectionOrder.filter((section) => !config.hiddenSections.includes(section)),
  );
  const navLinks = [
    { href: "#music", id: "music", label: "Music" },
    ...(platformLinks.length && (visibleSections.has("platforms") || visibleSections.has("links"))
      ? [{ href: "#platforms", id: "platforms", label: "Listen" }]
      : []),
    ...(visibleSections.has("about") ? [{ href: "#about", id: "about", label: "About" }] : []),
    ...(visibleSections.has("contact") ? [{ href: "#contact", id: "contact", label: "Contact" }] : []),
  ];

  return (
    <div className="retrofuture-site-root relative z-[1] min-h-screen overflow-x-hidden bg-paper">
      {preview ? <div className="artist-site-preview-ribbon">Private draft preview</div> : null}
      <HashScrollRestorer />
      <Navbar
        artistName={viewModel.artist.name}
        logoUrl={content.logoUrl || null}
        links={navLinks}
      />
      <main id="main-content" className="relative flex min-h-screen flex-col">
        {config.sectionOrder.map((section) => renderSection(section, props))}
        <Footer artistName={viewModel.artist.name} socialLinks={platformLinks} />
      </main>
    </div>
  );
}
