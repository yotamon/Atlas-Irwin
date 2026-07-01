/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { HomepageCatalogPreview } from "@/components/studio/homepage-catalog-preview";
import {
  createTrackFromSoundCloud,
  createTrackFromSpotify,
  dismissSoundCloudTrack,
  dismissSpotifyTrack,
  linkExternalSoundCloudTrack,
  linkExternalSpotifyTrack,
  moveHomepagePlacement,
  moveTrack,
  publishRelease,
  saveHomepagePlacement,
  saveWebsiteDetails,
  setActiveRelease,
  detachMediaAsset,
  updateMediaLink,
} from "@/app/studio/catalog-actions";
import {
  deleteRelease,
  deleteStudioRecord,
  generateContentPack,
  generateIdentity,
  saveTrack,
} from "@/app/studio/actions";
import { ReleaseForm } from "@/components/studio/release-form";
import { MediaUploader } from "@/components/studio/media-uploader";
import { ConfirmButton } from "@/components/studio/submit-button";
import { EmptyState, Field, Status, Submit } from "@/components/studio/ui";
import { publishStateLabel } from "@/lib/studio/catalog-labels";
import { contentPerformanceScore } from "@/lib/studio/performance";
import { calculateReleaseReadiness } from "@/lib/studio/readiness";
import type {
  ContentItem,
  HomepagePlacement,
  Json,
  MediaAsset,
  MediaLink,
  MetricSnapshot,
  Release,
  ReleaseExternalLink,
  SoundCloudTrack,
  SpotifyTrack,
  Track,
  TrackExternalId,
} from "@/types/database";
import type { Release as PublicRelease } from "@/lib/releases/types";
import { compatibleMediaTypes, mediaMetadata, mediaTypeLabel } from "@/lib/studio/media";

const TABS = [
  ["overview", "Overview"],
  ["music", "Music"],
  ["media", "Media"],
  ["website", "Website"],
  ["campaign", "Campaign"],
  ["performance", "Performance"],
] as const;

function dateLabel(value: string | null) {
  return value ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`)) : "Date not set";
}

function duration(seconds: number | null) {
  return seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "—";
}

function ratio(numerator: number, denominator: number) {
  return denominator ? `${((numerator / denominator) * 100).toFixed(1)}%` : "—";
}

function sum(metrics: MetricSnapshot[], key: keyof MetricSnapshot) {
  return metrics.reduce((total, metric) => total + (typeof metric[key] === "number" ? metric[key] as number : 0), 0);
}

function assetUsage(asset: MediaAsset, mediaLinks: MediaLink[]) {
  const links = mediaLinks.filter((link) => link.media_asset_id === asset.id);
  const locations = new Set<string>();
  links.forEach((link) => {
    if (link.release_id) locations.add("Release workspace");
    if (link.track_id) locations.add("Track");
    if (link.content_item_id) locations.add("Campaign content");
    if (link.role === "cover" && link.is_primary) locations.add("Public cover");
    if (link.role === "audio_preview") locations.add("Public player");
  });
  return [...locations];
}

export function ReleaseCockpit({
  release,
  tracks,
  placement,
  mediaLinks,
  mediaAssets,
  mediaPreviewUrls,
  externalLinks,
  externalTrackIds,
  contentCount,
  contactCount,
  contentItems,
  metrics,
  unmatchedSoundCloud,
  unmatchedSpotify,
  publicReleases,
  tab,
}: {
  release: Release;
  tracks: Track[];
  placement: HomepagePlacement | null;
  mediaLinks: MediaLink[];
  mediaAssets: MediaAsset[];
  mediaPreviewUrls: Record<string, string>;
  externalLinks: ReleaseExternalLink[];
  externalTrackIds: TrackExternalId[];
  contentCount: number;
  contactCount: number;
  contentItems: ContentItem[];
  metrics: MetricSnapshot[];
  unmatchedSoundCloud: SoundCloudTrack[];
  unmatchedSpotify: SpotifyTrack[];
  publicReleases: PublicRelease[];
  tab: string;
}) {
  const currentTab = tab === "tracks" || tab === "distribution" ? "music" : tab === "analytics" ? "performance" : TABS.some(([key]) => key === tab) ? tab : "overview";
  const readiness = calculateReleaseReadiness({ release, tracks, placement, mediaAssets, mediaLinks, externalLinks, content: contentItems, unresolvedConflicts: unmatchedSoundCloud.length + unmatchedSpotify.length });
  const identity = (release.release_identity ?? {}) as Record<string, Json>;
  const answers = (release.story_answers ?? {}) as Record<string, string>;
  const primaryTrack = tracks.find((track) => track.is_primary) ?? tracks[0];
  const defaultTrack = tracks.find((track) => track.id === placement?.default_track_id) ?? primaryTrack;
  const totals = {
    plays: sum(metrics, "streams"), views: sum(metrics, "views"), saves: sum(metrics, "saves"),
    profileVisits: sum(metrics, "profile_visits"), follows: sum(metrics, "follows"), clicks: sum(metrics, "link_clicks"),
    watchTime: sum(metrics, "watch_time"), shares: sum(metrics, "shares"), likes: sum(metrics, "likes"),
  };
  const scoredContent = contentItems.map((item) => {
    const rows = metrics.filter((metric) => metric.content_item_id === item.id);
    const aggregate = { views: sum(rows, "views"), saves: sum(rows, "saves"), profile_visits: sum(rows, "profile_visits"), follows: sum(rows, "follows"), link_clicks: sum(rows, "link_clicks"), shares: sum(rows, "shares"), watch_time: sum(rows, "watch_time"), likes: sum(rows, "likes") };
    return { item, aggregate, score: contentPerformanceScore(aggregate) };
  }).filter((entry) => entry.aggregate.views || entry.score).sort((a, b) => b.score - a.score);
  const insight = scoredContent.length >= 2 && scoredContent[0].score > scoredContent[1].score
    ? `${scoredContent[0].item.format} “${scoredContent[0].item.title}” drove the strongest weighted response in this campaign, led by ${scoredContent[0].aggregate.profile_visits.toLocaleString()} profile visits and ${scoredContent[0].aggregate.saves.toLocaleString()} saves.`
    : null;

  return (
    <>
      <header className="workspace-header">
        <div className="workspace-artwork">{release.artwork_url ? <img src={release.artwork_url} alt={release.cover_alt || ""} /> : <div className="empty-orbit" />}</div>
        <div className="workspace-title">
          <div className="catalog-card-badges"><Status>{publishStateLabel(release.publish_state)}</Status><Status>{release.is_public ? "Public" : "Private"}</Status>{release.active_release ? <Status>Active release</Status> : null}{placement?.enabled ? <Status>Homepage</Status> : null}</div>
          <h1>{release.title}</h1>
          <p>{release.release_type} · {dateLabel(release.release_date)}{release.label ? ` · ${release.label}` : ""}</p>
        </div>
        <Link className="workspace-score" href="#readiness"><strong>{readiness.score}</strong><span>% ready</span><small>{readiness.blockers.length ? `${readiness.blockers.length} blocker${readiness.blockers.length === 1 ? "" : "s"}` : "Ready to publish"}</small></Link>
        <div className="workspace-actions">
          {!release.active_release ? <form action={setActiveRelease}><input type="hidden" name="release_id" value={release.id} /><button className="button">Make active</button></form> : null}
          <Link className="button" href={`/?preview=${release.slug}#music`} target="_blank">Preview website</Link>
          {readiness.canPublish ? <form action={publishRelease}><input type="hidden" name="release_id" value={release.id} /><input type="hidden" name="publish_state" value={release.publish_state === "live" ? "draft" : "live"} /><input type="hidden" name="is_public" value={release.publish_state === "live" ? "" : "on"} /><button className="button primary">{release.publish_state === "live" ? "Unpublish" : "Publish release"}</button></form> : <Link className="button primary" href="#readiness">Resolve blockers</Link>}
        </div>
      </header>

      <nav className="studio-tabs release-tabs" aria-label="Release workspace">
        {TABS.map(([key, label]) => <Link key={key} href={`/studio/releases/${release.id}?tab=${key}`} className={currentTab === key ? "active" : undefined}>{label}{key === "media" && mediaAssets.length ? <small>{mediaAssets.length}</small> : null}{key === "campaign" && contentCount ? <small>{contentCount}</small> : null}</Link>)}
      </nav>

      {currentTab === "overview" ? (
        <div className="workspace-grid">
          <section className="workspace-main" id="identity">
            <div className="section-head"><div><span className="section-label">Release overview</span><h2>Identity and story</h2></div></div>
            <ReleaseForm release={release} />
            <div className="story-builder">
              <form action={generateIdentity} className="studio-form">
                <input type="hidden" name="id" value={release.id} />
                <div className="form-grid"><Field label="What emotional moment does this release represent?" wide><textarea name="emotional_moment" defaultValue={answers.emotional_moment} /></Field><Field label="What makes it musically distinctive?" wide><textarea name="musical_distinction" defaultValue={answers.musical_distinction} /></Field></div>
                <Submit>Build release identity</Submit>
              </form>
              {identity.oneLineIdentity ? <blockquote>{String(identity.oneLineIdentity)}</blockquote> : null}
            </div>
          </section>
          <aside className="readiness-panel" id="readiness">
            <div className="section-head"><div><span className="section-label">Release readiness</span><h2>{readiness.completed} of {readiness.total} complete</h2></div></div>
            <div className="progress"><span style={{ width: `${readiness.score}%` }} /></div>
            <p className="readiness-explainer">Required publishing checks are marked as blockers. Campaign recommendations never prevent release.</p>
            <div className="readiness-list">{readiness.items.map((item) => <Link href={item.href} className={item.complete ? "complete" : item.blocking ? "blocking" : "recommended"} key={item.id}><span>{item.complete ? "✓" : item.blocking ? "!" : "+"}</span><span><strong>{item.label}</strong><small>{item.detail}</small></span><em>{item.complete ? "Done" : item.blocking ? "Blocker" : "Recommended"}</em></Link>)}</div>
          </aside>
        </div>
      ) : null}

      {currentTab === "music" ? (
        <div className="workspace-stack">
          <section className="workspace-section" id="tracklist">
            <div className="section-head"><div><span className="section-label">Music</span><h2>Tracklist and playback</h2></div><span>{tracks.length} track{tracks.length === 1 ? "" : "s"}</span></div>
            {tracks.length ? <div className="track-table"><div className="track-row track-head"><span>Order</span><span>Track</span><span>Duration</span><span>Playback</span><span>Identifiers</span><span>Actions</span></div>{tracks.map((track, index) => {
              const ids = externalTrackIds.filter((item) => item.track_id === track.id);
              return <article className="track-row" key={track.id}><div className="order-controls"><strong>{String(index + 1).padStart(2, "0")}</strong><form action={moveTrack}><input type="hidden" name="track_id" value={track.id} /><input type="hidden" name="release_id" value={release.id} /><button name="direction" value="up" disabled={index === 0} aria-label={`Move ${track.title} up`}>↑</button><button name="direction" value="down" disabled={index === tracks.length - 1} aria-label={`Move ${track.title} down`}>↓</button></form></div><div><strong>{track.title}</strong><small>{track.version || "Master"}{track.is_primary ? " · Primary" : ""}{defaultTrack?.id === track.id ? " · Homepage default" : ""}</small></div><span>{duration(track.duration)}</span><div className="platform-dots"><span className={track.audio_url ? "connected" : undefined}>Preview</span><span className={track.soundcloud_url ? "connected" : undefined}>SoundCloud</span><span className={track.spotify_url ? "connected" : undefined}>Spotify</span></div><div>{ids.length ? ids.map((id) => <small key={id.id}>{id.provider.toUpperCase()} · {id.external_id}</small>) : <small>No stable IDs</small>}</div><form action={deleteStudioRecord}><input type="hidden" name="id" value={track.id} /><input type="hidden" name="table" value="tracks" /><button className="text-button">Delete</button></form></article>;
            })}</div> : <EmptyState title="No music attached" body="Add the first canonical track. External syncs never create one silently." />}
            <details className="workspace-drawer"><summary>Add a catalog track</summary><form action={saveTrack} className="studio-form"><input type="hidden" name="release_id" value={release.id} /><div className="form-grid"><Field label="Track title"><input name="title" required /></Field><Field label="Version"><input name="version" /></Field><Field label="Duration (seconds)"><input type="number" min="0" name="duration" /></Field><Field label="Audio preview URL"><input name="audio_url" /></Field><Field label="SoundCloud URL"><input name="soundcloud_url" /></Field><Field label="Spotify URL"><input name="spotify_url" /></Field><Field label="Primary track"><span className="checkbox-field"><input type="checkbox" name="is_primary" /> Use as the primary release track</span></Field></div><Submit>Add track</Submit></form></details>
          </section>

          <section className="workspace-section" id="platform-links">
            <div className="section-head"><div><span className="section-label">Distribution</span><h2>Release listening destinations</h2></div></div>
            <ReleaseForm release={release} />
            {externalLinks.length ? <div className="external-link-rail">{externalLinks.map((link) => <a href={link.external_url} target="_blank" rel="noreferrer" key={link.id}><span>{link.provider}</span><strong>{link.label || link.external_url}</strong><small>{link.synced_at ? `Synced ${dateLabel(link.synced_at.slice(0, 10))}` : "Manual link"}</small></a>)}</div> : null}
          </section>

          <section className="workspace-section reconciliation-section">
            <div className="section-head"><div><span className="section-label">Reconciliation</span><h2>Possible external matches</h2></div><Link href="/studio/data-health?category=unmatched">Open full queue</Link></div>
            {unmatchedSoundCloud.length || unmatchedSpotify.length ? <div className="reconciliation-list">
              {unmatchedSoundCloud.map((external) => <article key={external.id}><div><Status>SoundCloud</Status><h3>{external.title}</h3><p>{external.duration ? `${duration(Math.round(external.duration / 1000))} · ` : ""}Synced {dateLabel(external.synced_at.slice(0, 10))}</p></div><div className="match-reason"><strong>Suggested because</strong><span>Exact normalized title match with this release or tracklist.</span></div><form action={linkExternalSoundCloudTrack}><input type="hidden" name="external_id" value={external.id} /><select name="track_id" required defaultValue=""><option value="" disabled>Link to existing track</option>{tracks.map((track) => <option value={track.id} key={track.id}>{track.title}</option>)}</select><button className="button">Link</button></form><form action={createTrackFromSoundCloud}><input type="hidden" name="external_id" value={external.id} /><input type="hidden" name="release_id" value={release.id} /><button className="text-button">Create track in this release</button></form><form action={dismissSoundCloudTrack}><input type="hidden" name="id" value={external.id} /><button className="text-button">Dismiss</button></form></article>)}
              {unmatchedSpotify.map((external) => <article key={external.id}><div><Status>Spotify</Status><h3>{external.name}</h3><p>{duration(Math.round(external.duration_ms / 1000))} · Synced {dateLabel(external.synced_at.slice(0, 10))}</p></div><div className="match-reason"><strong>Suggested because</strong><span>{external.isrc ? `Title match; ISRC ${external.isrc} available for verification.` : "Exact normalized title match with this release or tracklist."}</span></div><form action={linkExternalSpotifyTrack}><input type="hidden" name="external_id" value={external.id} /><select name="track_id" required defaultValue=""><option value="" disabled>Link to existing track</option>{tracks.map((track) => <option value={track.id} key={track.id}>{track.title}</option>)}</select><button className="button">Link</button></form><form action={createTrackFromSpotify}><input type="hidden" name="external_id" value={external.id} /><input type="hidden" name="release_id" value={release.id} /><button className="text-button">Create track in this release</button></form><form action={dismissSpotifyTrack}><input type="hidden" name="id" value={external.id} /><button className="text-button">Dismiss</button></form></article>)}
            </div> : <EmptyState title="No likely conflicts for this release" body="The wider unmatched queue remains available in Data Health." href="/studio/data-health?category=unmatched" label="Review all unmatched tracks" />}
          </section>
        </div>
      ) : null}

      {currentTab === "media" ? (
        <div className="workspace-stack">
          <section className="workspace-section" id="assets">
            <div className="section-head"><div><span className="section-label">Release media</span><h2>Asset coverage and usage</h2></div><Link href="/studio/media">Open global library</Link></div>
            {mediaAssets.length ? <div className="release-media-grid">{mediaAssets.map((asset) => {
              const assetLinks = mediaLinks.filter((item) => item.media_asset_id === asset.id);
              const link = assetLinks[0];
              const usage = assetUsage(asset, mediaLinks);
              const metadata = mediaMetadata(asset);
              const previewUrl = mediaPreviewUrls[asset.id];
              const roleOptions = compatibleMediaTypes(asset.mime_type);
              return <article key={asset.id}><div className="release-media-thumb">{previewUrl && asset.mime_type?.startsWith("image/") ? <img src={previewUrl} alt={link?.alt_text || ""} /> : previewUrl && asset.mime_type?.startsWith("video/") ? <video src={previewUrl} muted controls playsInline preload="metadata" /> : previewUrl && asset.mime_type?.startsWith("audio/") ? <audio src={previewUrl} controls preload="metadata" /> : <span>{mediaTypeLabel(asset.asset_type)}</span>}</div><div><span className="section-label">{mediaTypeLabel(link?.role || asset.asset_type)}</span><h3>{metadata.title}</h3><p>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : "Dimensions unavailable"}{asset.duration_ms ? ` · ${duration(Math.round(asset.duration_ms / 1000))}` : ""}<br />{asset.mime_type || "Unknown format"}</p><div className="usage-map">{usage.length ? usage.map((item) => <span key={item}>{item}</span>) : <span>Attached to release</span>}</div>{assetLinks.map((mediaLink) => <details className="release-media-settings" key={mediaLink.id}><summary>Assignment settings</summary><form action={updateMediaLink} className="compact-media-form"><input type="hidden" name="media_link_id" value={mediaLink.id} /><Field label="Role"><select name="role" defaultValue={mediaLink.role}>{roleOptions.map((role) => <option key={role} value={role}>{mediaTypeLabel(role)}</option>)}</select></Field><Field label="Alt text"><input name="alt_text" defaultValue={mediaLink.alt_text ?? ""} /></Field><Field label="Caption"><input name="caption" defaultValue={mediaLink.caption ?? ""} /></Field><label className="checkbox-field"><input type="checkbox" name="is_primary" defaultChecked={mediaLink.is_primary} /> Primary for this role</label><Submit>Save assignment</Submit></form><form action={detachMediaAsset}><input type="hidden" name="media_link_id" value={mediaLink.id} /><ConfirmButton message={`Detach ${metadata.title} from this release?`}>Detach from release</ConfirmButton></form></details>)}</div></article>;
            })}</div> : <EmptyState title="No assets attached" body="Upload a release asset here or attach an existing file from the global Media Library." href="/studio/media" label="Browse media library" />}
          </section>
          <section className="workspace-section" id="upload"><div className="section-head"><div><span className="section-label">Upload</span><h2>Add without duplicating</h2></div></div><p className="section-copy">Upload directly to the secure media store, then attach it here. Images, motion, previews, masters, and stems each get compatible roles automatically.</p><MediaUploader releaseId={release.id} /></section>
        </div>
      ) : null}

      {currentTab === "website" ? (
        <div className="website-workspace">
          <div className="website-controls">
            <section className="workspace-section" id="placement"><div className="section-head"><div><span className="section-label">Homepage placement</span><h2>Position and player behavior</h2></div></div><form action={saveHomepagePlacement} className="studio-form"><input type="hidden" name="release_id" value={release.id} /><div className="form-grid"><Field label="Homepage visibility"><span className="checkbox-field"><input type="checkbox" name="enabled" defaultChecked={placement?.enabled} /> Show in the public release player</span></Field><Field label="Placement type"><select name="placement_type" defaultValue={placement?.placement_type || "catalog"}><option value="featured">Featured</option><option value="catalog">Catalog</option><option value="upcoming">Upcoming</option></select></Field><Field label="Display order"><input type="number" min="0" name="display_order" defaultValue={placement?.display_order ?? 0} /></Field><Field label="Default homepage track"><select name="default_track_id" defaultValue={placement?.default_track_id || ""}><option value="">Select intentionally</option>{tracks.map((track) => <option key={track.id} value={track.id}>{track.title}</option>)}</select></Field></div><Submit>Save placement</Submit></form>{placement?.enabled ? <div className="move-controls"><span>Accessible order controls</span><form action={moveHomepagePlacement}><input type="hidden" name="release_id" value={release.id} /><button className="button" name="direction" value="up">Move earlier</button><button className="button" name="direction" value="down">Move later</button></form></div> : null}</section>
            <section className="workspace-section" id="public-details"><div className="section-head"><div><span className="section-label">Public details</span><h2>CTA and artwork description</h2></div></div><form action={saveWebsiteDetails} className="studio-form"><input type="hidden" name="release_id" value={release.id} /><div className="form-grid"><Field label="CTA label"><input name="cta_label" defaultValue={release.cta_label || ""} placeholder="Listen now" /></Field><Field label="CTA link"><input name="cta_href" type="url" defaultValue={release.cta_href || ""} /></Field><Field label="Public artwork alt text" wide><input name="cover_alt" defaultValue={release.cover_alt || ""} placeholder="Describe the artwork for someone who cannot see it" /></Field><Field label="Homepage eligible"><span className="checkbox-field"><input type="checkbox" name="homepage_eligible" defaultChecked={release.homepage_eligible} /> This release may appear on the homepage</span></Field></div><Submit>Save public details</Submit></form></section>
            <section className="workspace-section visibility-control" id="publishing"><div className="section-head"><div><span className="section-label">Publishing</span><h2>Public visibility</h2></div></div><p>Changing this state affects the actual public catalog after save. No redeploy is required.</p><details><summary>{release.publish_state === "live" ? "Change or unpublish release" : "Review publishing controls"}</summary><form action={publishRelease} className="studio-form"><input type="hidden" name="release_id" value={release.id} /><Field label="Publish state"><select name="publish_state" defaultValue={release.publish_state}><option value="draft">Draft</option><option value="scheduled">Scheduled</option><option value="live">Live</option><option value="archived">Archived</option></select></Field><Field label="Public website"><span className="checkbox-field"><input type="checkbox" name="is_public" defaultChecked={release.is_public} /> Publicly readable when state permits</span></Field><Submit>Apply visibility change</Submit></form></details></section>
          </div>
          <aside className="website-live-preview"><div className="section-head"><div><span className="section-label">Live public rendering</span><h2>Homepage preview</h2></div><a href="/studio/homepage-preview" target="_blank">Open exact player</a></div><div className="live-preview-frame tall"><HomepageCatalogPreview releases={publicReleases} /></div><dl><div><dt>Current artwork</dt><dd>{release.artwork_url ? "Attached" : "Fallback"}</dd></div><div><dt>Player default</dt><dd>{defaultTrack?.title || "Not selected"}</dd></div><div><dt>CTA</dt><dd>{release.cta_label || "Automatic"}</dd></div><div><dt>Visibility</dt><dd>{release.publish_state === "live" && release.is_public && placement?.enabled ? "Visible" : "Not currently visible"}</dd></div></dl></aside>
        </div>
      ) : null}

      {currentTab === "campaign" ? (
        <div className="workspace-stack">
          <section className="campaign-brief"><div><span className="section-label">Campaign goal</span><h2>{release.primary_hook || "Define the reason this release should travel"}</h2><p>{release.audience || "Add target audience notes in the Overview so content decisions have a clear listener."}</p></div><dl><div><dt>Window</dt><dd>{release.release_date ? `Around ${dateLabel(release.release_date)}` : "Release date needed"}</dd></div><div><dt>Featured track</dt><dd>{primaryTrack?.title || "Select a primary track"}</dd></div><div><dt>Status</dt><dd>{release.active_release ? "Active" : release.status}</dd></div><div><dt>Asset coverage</dt><dd>{mediaAssets.filter((asset) => ["canvas_video", "visualizer", "social_image", "content_video", "lyric_video"].includes(asset.asset_type)).length} campaign assets</dd></div></dl></section>
          <section className="workspace-section" id="content-plan"><div className="section-head"><div><span className="section-label">Campaign sequence</span><h2>From anticipation to evergreen</h2></div><Link className="button primary" href={`/studio/content?release=${release.id}#new`}>Create content</Link></div><div className="campaign-phases">{[["Pre-release", contentItems.filter((item) => item.scheduled_at && release.release_date && item.scheduled_at.slice(0, 10) < release.release_date)], ["Release day", contentItems.filter((item) => item.scheduled_at?.slice(0, 10) === release.release_date)], ["Post-release momentum", contentItems.filter((item) => item.scheduled_at && release.release_date && item.scheduled_at.slice(0, 10) > release.release_date)], ["Evergreen / catalog revival", contentItems.filter((item) => !item.scheduled_at)]].map(([label, rawItems]) => { const items = rawItems as ContentItem[]; return <div key={label as string}><h3>{label as string}<span>{items.length}</span></h3>{items.length ? items.map((item) => <Link href={`/studio/content?edit=${item.id}`} key={item.id}><time>{item.scheduled_at ? dateLabel(item.scheduled_at.slice(0, 10)) : "Unscheduled"}</time><span><strong>{item.title}</strong><small>{item.platform} · {item.format} · {item.goal}</small></span><Status>{item.status}</Status></Link>) : <p>No actions planned in this phase.</p>}</div>; })}</div></section>
          <section className="campaign-coverage"><div><span className="section-label">Planned content</span><strong>{contentCount}</strong><small>{contentItems.filter((item) => item.status === "Scheduled").length} scheduled</small></div><div><span className="section-label">Outreach actions</span><strong>{contactCount}</strong><small>explicitly user-controlled</small></div><div><span className="section-label">Campaign assets</span><strong>{mediaAssets.filter((asset) => ["canvas_video", "visualizer", "social_image", "content_video", "lyric_video"].includes(asset.asset_type)).length}</strong><small>motion and social coverage</small></div><form action={generateContentPack}><input type="hidden" name="id" value={release.id} /><button className="button">Prepare editable content pack</button><small>Creates drafts only. Nothing is published or sent.</small></form></section>
        </div>
      ) : null}

      {currentTab === "performance" ? (
        <div className="workspace-stack">
          <section className="performance-overview"><div><span>Plays</span><strong>{totals.plays.toLocaleString()}</strong></div><div><span>Save rate</span><strong>{ratio(totals.saves, totals.plays)}</strong><small>{totals.saves.toLocaleString()} saves</small></div><div><span>Follow conversion</span><strong>{ratio(totals.follows, totals.profileVisits)}</strong><small>{totals.follows.toLocaleString()} follows / {totals.profileVisits.toLocaleString()} visits</small></div><div><span>Click-through</span><strong>{ratio(totals.clicks, totals.views)}</strong><small>{totals.clicks.toLocaleString()} clicks / {totals.views.toLocaleString()} views</small></div><div><span>Watch quality</span><strong>{totals.views ? `${Math.round(totals.watchTime / totals.views)}s` : "—"}</strong><small>average recorded watch time</small></div></section>
          <section className="workspace-section"><div className="section-head"><div><span className="section-label">Content performance</span><h2>Totals, rates, and weighted response</h2></div><Link href="/studio/analytics">All analytics</Link></div>{scoredContent.length ? <div className="performance-table"><div className="performance-row head"><span>Content</span><span>Views</span><span>Profile visits</span><span>Save rate</span><span>Weighted score</span></div>{scoredContent.map(({ item, aggregate, score }) => <div className="performance-row" key={item.id}><span><strong>{item.title}</strong><small>{item.platform} · {item.format}</small></span><span>{aggregate.views.toLocaleString()}</span><span>{aggregate.profile_visits.toLocaleString()}</span><span>{ratio(aggregate.saves, aggregate.views)}</span><span>{score}<small>visits, follows and saves carry the most weight</small></span></div>)}</div> : <EmptyState title="No content-level performance yet" body="Add snapshots linked to campaign content. The Studio will not invent a performance story." href="/studio/analytics#new" label="Add a snapshot" />}</section>
          <section className="what-worked"><span className="section-label">What worked</span>{insight ? <p>{insight}</p> : <><h2>Not enough evidence yet</h2><p>At least two content items with linked metrics are needed before the Studio makes a comparison.</p></>}</section>
        </div>
      ) : null}

      <details className="danger-zone"><summary>Release administration</summary><p>Deleting a release also removes its canonical tracks and linked campaign records. This cannot be undone.</p><form action={deleteRelease}><input type="hidden" name="id" value={release.id} /><button className="text-button">Delete release permanently</button></form></details>
    </>
  );
}
