/* eslint-disable @next/next/no-img-element */
import { SmartLinkTracker } from "@/components/sites/smart-link-tracker";
import type { PublishedSiteRuntime } from "@/lib/sites/runtime";
import type { SmartLinkRuntime } from "@/lib/smart-links/runtime";
import styles from "./release-smart-link.module.css";

const TRACKED_KEYS = ["src", "utm_source", "utm_medium", "utm_campaign", "utm_content"] as const;

function dateLabel(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en", { month: "long", day: "numeric", year: "numeric", timeZone: "Europe/Berlin" }).format(new Date(`${value}T12:00:00+02:00`));
}

export function ReleaseSmartLink({
  site,
  smartLink,
  searchParams,
}: {
  site: PublishedSiteRuntime;
  smartLink: SmartLinkRuntime;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const artistName = site.viewModel.artist.name || smartLink.release.artist_display_name || smartLink.release.primary_artist_name || "Artist";
  const query = new URLSearchParams();
  for (const key of TRACKED_KEYS) {
    const raw = searchParams[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value) query.set(key, value.slice(0, 200));
  }
  query.set("site", site.site.id);
  query.set("slug", smartLink.link.slug);
  const actionLabel = smartLink.mode === "pre_release" ? "Pre-save" : "Listen";

  return (
    <main
      className={styles.page}
      style={{
        "--smart-bg": site.config.theme.background,
        "--smart-fg": site.config.theme.foreground,
        "--smart-muted": site.config.theme.muted,
        "--smart-accent": site.config.theme.accent,
        "--smart-surface": site.config.theme.surface,
      } as React.CSSProperties}
    >
      <SmartLinkTracker siteId={site.site.id} slug={smartLink.link.slug} />
      <section className={styles.card}>
        <a className={styles.artist} href={site.primaryHostname ? `https://${site.primaryHostname}` : `/sites/${site.site.slug}`}>{artistName}</a>
        <div className={styles.artwork}>
          {smartLink.release.artwork_url ? <img src={smartLink.release.artwork_url} alt={smartLink.release.cover_alt || `${smartLink.release.title} artwork`} /> : <span>{smartLink.release.title.slice(0, 1)}</span>}
        </div>
        <div className={styles.copy}>
          <span>{smartLink.mode === "pre_release" ? `Coming ${dateLabel(smartLink.release.release_date) || "soon"}` : "Out now"}</span>
          <h1>{smartLink.release.title}</h1>
          <p>{smartLink.mode === "pre_release" ? `Choose where you want to ${actionLabel.toLowerCase()} ${smartLink.release.title}. This page becomes the release listening destination automatically on launch day.` : `Choose where you want to listen to ${smartLink.release.title}.`}</p>
        </div>
        {smartLink.destinations.length ? (
          <div className={styles.destinations}>
            {smartLink.destinations.map((destination) => (
              <a key={destination.id} href={`/smart-link/go/${destination.id}?${query.toString()}`}>
                <span>{destination.label}</span><strong>{destination.destination_kind === "pre_save" ? "Pre-save" : "Open"}</strong>
              </a>
            ))}
          </div>
        ) : (
          <div className={styles.empty}><strong>{smartLink.mode === "pre_release" ? "Pre-save destination coming soon" : "Listening links are being prepared"}</strong><span>The release page is already stable. Destinations can be added without changing this URL.</span></div>
        )}
        <footer><span>Powered by Ensemblis</span><span>First-party measurement · no fingerprinting</span></footer>
      </section>
    </main>
  );
}
