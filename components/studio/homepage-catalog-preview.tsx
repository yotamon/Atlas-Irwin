/* eslint-disable @next/next/no-img-element */
import type { Release } from "@/lib/releases/types";

export function HomepageCatalogPreview({ releases }: { releases: Release[] }) {
  const current = releases[0];
  if (!current) return <div className="preview-empty"><p>No release is publicly visible.</p></div>;
  const activeTrack = current.tracks.find((track) => track.active) ?? current.tracks[0];
  return (
    <div className="catalog-live-preview">
      <div className="catalog-preview-main">
        <div className="catalog-preview-art"><img src={current.coverUrl} alt={current.coverAlt} /><span>{current.featured ? "Featured release" : "Public release"}</span></div>
        <div className="catalog-preview-copy">
          <small>{current.artist}</small>
          <h3>{current.title}</h3>
          <p>{current.type} · {current.trackCount} track{current.trackCount === 1 ? "" : "s"}<br />{current.releaseDateLabel}</p>
          <div className="catalog-preview-track"><span>01</span><strong>{activeTrack?.title || "No playable track"}</strong><em>{activeTrack?.duration || "—"}</em></div>
          {current.ctaHref ? <a href={current.ctaHref} target="_blank" rel="noreferrer">{current.ctaLabel || "Listen now"}</a> : null}
        </div>
      </div>
      <div className="catalog-preview-order">{releases.map((release, index) => <div className={index === 0 ? "active" : undefined} key={release.slug}><span>{index + 1}</span>{release.coverUrl ? <img src={release.coverUrl} alt="" /> : null}<strong>{release.title}</strong><small>{release.type}</small></div>)}</div>
    </div>
  );
}
