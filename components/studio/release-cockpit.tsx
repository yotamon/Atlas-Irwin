import Link from "next/link";
import {
  publishRelease,
  saveHomepagePlacement,
  setActiveRelease,
  uploadReleaseMedia,
} from "@/app/studio/catalog-actions";
import {
  deleteRelease,
  deleteStudioRecord,
  generateContentPack,
  generateIdentity,
  saveCoverAsset,
  saveTrack,
  updateReadiness,
} from "@/app/studio/actions";
import { ReleaseForm } from "@/components/studio/release-form";
import { AssetUpload } from "@/components/studio/asset-upload";
import {
  Field,
  Panel,
  Status,
  Submit,
} from "@/components/studio/ui";
import { READINESS_ITEMS } from "@/lib/studio/constants";
import { publishStateLabel } from "@/lib/studio/catalog-labels";
import type {
  HomepagePlacement,
  Json,
  MediaAsset,
  MediaLink,
  Release,
  ReleaseExternalLink,
  Track,
  TrackExternalId,
} from "@/types/database";

const TABS = [
  ["overview", "Overview"],
  ["tracks", "Tracks & Versions"],
  ["media", "Media"],
  ["distribution", "Distribution"],
  ["website", "Website"],
  ["campaign", "Campaign"],
  ["analytics", "Analytics"],
] as const;

export function ReleaseCockpit({
  release,
  tracks,
  placement,
  mediaLinks,
  mediaAssets,
  externalLinks,
  externalTrackIds,
  contentCount,
  contactCount,
  tab,
}: {
  release: Release;
  tracks: Track[];
  placement: HomepagePlacement | null;
  mediaLinks: MediaLink[];
  mediaAssets: MediaAsset[];
  externalLinks: ReleaseExternalLink[];
  externalTrackIds: TrackExternalId[];
  contentCount: number;
  contactCount: number;
  tab: string;
}) {
  const readiness = (release.readiness ?? {}) as Record<string, boolean>;
  const automated: Record<string, boolean> = {
    Artwork: Boolean(release.artwork_url || release.cover_asset),
    "Smart link": Boolean(release.smart_link_url),
    "Release story": Boolean(release.story),
    "At least 6 content pieces": contentCount >= 6,
    "Outreach list": contactCount > 0,
    "At least 10 outreach targets": contactCount >= 10,
  };
  const completed = READINESS_ITEMS.filter(
    (item) => readiness[item] || automated[item],
  ).length;
  const identity = (release.release_identity ?? {}) as Record<string, Json>;
  const answers = (release.story_answers ?? {}) as Record<string, string>;
  const currentTab = TABS.some(([key]) => key === tab) ? tab : "overview";

  return (
    <>
      <nav className="studio-tabs release-tabs">
        {TABS.map(([key, label]) => (
          <Link
            key={key}
            href={`/studio/releases/${release.id}?tab=${key}`}
            className={currentTab === key ? "active" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>

      {currentTab === "overview" && (
        <div className="studio-grid">
          <Panel className="feature">
            <div className="hero-release">
              {release.artwork_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={release.artwork_url} alt="" />
              ) : (
                <div className="empty-orbit" />
              )}
              <div>
                <div className="catalog-card-badges">
                  <Status>{publishStateLabel(release.publish_state)}</Status>
                  {placement?.enabled && <Status>Homepage</Status>}
                  {release.active_release && <Status>Active release</Status>}
                </div>
                <h2>{release.title}</h2>
                <p>{release.story || release.core_emotion || "Shape the release story and publishing plan."}</p>
                <p>
                  {release.release_date
                    ? new Date(release.release_date).toLocaleDateString()
                    : "Release date open"}
                </p>
                <div className="form-actions">
                  <form action={setActiveRelease}>
                    <input type="hidden" name="release_id" value={release.id} />
                    <button className="button">Set active release</button>
                  </form>
                  <form action={publishRelease}>
                    <input type="hidden" name="release_id" value={release.id} />
                    <input type="hidden" name="publish_state" value="live" />
                    <input type="hidden" name="is_public" value="on" />
                    <button className="button primary">Publish live</button>
                  </form>
                  <Link className="button" href={`/?preview=${release.slug}`} target="_blank">
                    Preview homepage
                  </Link>
                </div>
              </div>
            </div>
          </Panel>
          <Panel title="Readiness">
            <div className="progress">
              <span style={{ width: `${Math.round((completed / READINESS_ITEMS.length) * 100)}%` }} />
            </div>
            <p>
              {completed} of {READINESS_ITEMS.length} complete
            </p>
            <form action={updateReadiness} className="checklist">
              <input type="hidden" name="id" value={release.id} />
              {READINESS_ITEMS.map((item) => (
                <label key={item}>
                  <input
                    type="checkbox"
                    name="item"
                    value={item}
                    defaultChecked={Boolean(readiness[item] || automated[item])}
                    disabled={Boolean(automated[item])}
                  />
                  {item}
                  {automated[item] && <small>auto</small>}
                </label>
              ))}
              <Submit>Update checklist</Submit>
            </form>
          </Panel>
          <Panel title="Primary links">
            <ul className="link-list">
              {release.spotify_url && <li><a href={release.spotify_url}>Spotify</a></li>}
              {release.soundcloud_url && <li><a href={release.soundcloud_url}>SoundCloud</a></li>}
              {release.youtube_url && <li><a href={release.youtube_url}>YouTube</a></li>}
              {release.smart_link_url && <li><a href={release.smart_link_url}>Smart link</a></li>}
            </ul>
          </Panel>
        </div>
      )}

      {currentTab === "tracks" && (
        <Panel title="Tracks & versions" className="feature">
          {tracks.length ? (
            <table className="studio-table">
              <thead>
                <tr>
                  <th>Track</th>
                  <th>Version</th>
                  <th>Duration</th>
                  <th>Primary</th>
                  <th>Links</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tracks.map((track) => (
                  <tr key={track.id}>
                    <td>{track.title}</td>
                    <td>{track.version || "Master"}</td>
                    <td>
                      {track.duration
                        ? `${Math.floor(track.duration / 60)}:${String(track.duration % 60).padStart(2, "0")}`
                        : "—"}
                    </td>
                    <td>{track.is_primary ? "Yes" : ""}</td>
                    <td>
                      {track.soundcloud_url && <small>SoundCloud</small>}
                      {track.spotify_url && <small>Spotify</small>}
                    </td>
                    <td>
                      <form action={deleteStudioRecord}>
                        <input type="hidden" name="id" value={track.id} />
                        <input type="hidden" name="table" value="tracks" />
                        <button className="text-button">Delete</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No tracks yet.</p>
          )}
          <form action={saveTrack} className="studio-form">
            <input type="hidden" name="release_id" value={release.id} />
            <div className="form-grid">
              <Field label="Track title"><input name="title" required /></Field>
              <Field label="Version"><input name="version" /></Field>
              <Field label="Duration (seconds)"><input type="number" min="0" name="duration" /></Field>
              <Field label="Audio preview URL"><input name="audio_url" /></Field>
              <Field label="SoundCloud URL"><input name="soundcloud_url" /></Field>
              <Field label="Spotify URL"><input name="spotify_url" /></Field>
              <Field label="Primary track"><input type="checkbox" name="is_primary" /></Field>
            </div>
            <Submit>Add track</Submit>
          </form>
          {externalTrackIds.length > 0 && (
            <div className="identity-grid">
              <article>
                <h3>External identifiers</h3>
                <ul>
                  {externalTrackIds.map((item) => (
                    <li key={item.id}>
                      {item.provider}: {item.external_id}
                    </li>
                  ))}
                </ul>
              </article>
            </div>
          )}
        </Panel>
      )}

      {currentTab === "media" && (
        <Panel title="Media library" className="feature">
          <div className="catalog-grid">
            {mediaAssets.map((asset) => {
              const link = mediaLinks.find((item) => item.media_asset_id === asset.id);
              return (
                <article key={asset.id} className="catalog-card">
                  {asset.public_url && asset.mime_type?.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={asset.public_url} alt={link?.alt_text || ""} />
                  ) : (
                    <div className="empty-orbit" />
                  )}
                  <div className="catalog-card-body">
                    <Status>{asset.asset_type}</Status>
                    <p>{asset.visibility}</p>
                    <small>{asset.mime_type}</small>
                  </div>
                </article>
              );
            })}
          </div>
          <form action={uploadReleaseMedia} className="studio-form">
            <input type="hidden" name="release_id" value={release.id} />
            <div className="form-grid">
              <Field label="Asset role">
                <select name="role" defaultValue="cover">
                  {[
                    "cover",
                    "alternate_artwork",
                    "canvas_video",
                    "visualizer",
                    "audio_preview",
                    "social_image",
                    "press_image",
                  ].map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Visibility">
                <select name="visibility" defaultValue="public">
                  <option value="public">Public website</option>
                  <option value="private">Private production</option>
                </select>
              </Field>
              <Field label="Alt text"><input name="alt_text" /></Field>
              <Field label="Primary for role"><input type="checkbox" name="is_primary" defaultChecked /></Field>
              <Field label="File"><input type="file" name="file" required /></Field>
            </div>
            <Submit>Upload media</Submit>
          </form>
        </Panel>
      )}

      {currentTab === "distribution" && (
        <Panel title="Distribution" className="feature">
          <ReleaseForm release={release} />
          <ul className="link-list">
            {externalLinks.map((link) => (
              <li key={link.id}>
                <a href={link.external_url}>{link.label || link.provider}</a>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {currentTab === "website" && (
        <Panel title="Website control" className="feature">
          <form action={saveHomepagePlacement} className="studio-form">
            <input type="hidden" name="release_id" value={release.id} />
            <div className="form-grid">
              <Field label="Show on homepage">
                <input type="checkbox" name="enabled" defaultChecked={placement?.enabled} />
              </Field>
              <Field label="Placement type">
                <select name="placement_type" defaultValue={placement?.placement_type || "catalog"}>
                  <option value="featured">Featured</option>
                  <option value="catalog">Catalog</option>
                  <option value="upcoming">Upcoming</option>
                </select>
              </Field>
              <Field label="Homepage order">
                <input type="number" min="0" name="display_order" defaultValue={placement?.display_order ?? 0} />
              </Field>
              <Field label="Default player track">
                <select name="default_track_id" defaultValue={placement?.default_track_id || ""}>
                  <option value="">Primary track</option>
                  {tracks.map((track) => (
                    <option key={track.id} value={track.id}>
                      {track.title}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Submit>Save homepage placement</Submit>
          </form>
          <form action={publishRelease} className="studio-form">
            <input type="hidden" name="release_id" value={release.id} />
            <div className="form-grid">
              <Field label="Publish state">
                <select name="publish_state" defaultValue={release.publish_state}>
                  <option value="draft">Draft</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="live">Live</option>
                  <option value="archived">Archived</option>
                </select>
              </Field>
              <Field label="Public website">
                <input type="checkbox" name="is_public" defaultChecked={release.is_public} />
              </Field>
            </div>
            <Submit>Publish changes</Submit>
          </form>
        </Panel>
      )}

      {currentTab === "campaign" && (
        <>
          <Panel title="Release information" className="feature">
            <ReleaseForm release={release} />
            <form action={saveCoverAsset} className="form-actions">
              <input type="hidden" name="id" value={release.id} />
              <AssetUpload folder={`releases/${release.id}`} />
              <button className="button">Attach uploaded cover</button>
            </form>
          </Panel>
          <Panel title="Release story builder" className="feature">
            <form action={generateIdentity} className="studio-form">
              <input type="hidden" name="id" value={release.id} />
              <div className="form-grid">
                <Field label="What emotional moment does this track represent?" wide>
                  <textarea name="emotional_moment" defaultValue={answers.emotional_moment} />
                </Field>
                <Field label="What makes it musically distinctive?" wide>
                  <textarea name="musical_distinction" defaultValue={answers.musical_distinction} />
                </Field>
              </div>
              <Submit>Generate release identity</Submit>
            </form>
            {identity.oneLineIdentity && (
              <div className="identity-grid">
                <article>
                  <h3>One-line identity</h3>
                  <p>{String(identity.oneLineIdentity)}</p>
                </article>
              </div>
            )}
            <form action={generateContentPack}>
              <input type="hidden" name="id" value={release.id} />
              <button className="button primary">Generate content pack</button>
            </form>
          </Panel>
        </>
      )}

      {currentTab === "analytics" && (
        <Panel title="Analytics" className="feature">
          <p>Track performance snapshots from SoundCloud and manual metrics in Insights.</p>
          <Link className="button" href="/studio/analytics">Open Insights</Link>
        </Panel>
      )}

      <form action={deleteRelease}>
        <input type="hidden" name="id" value={release.id} />
        <button className="text-button">Delete release</button>
      </form>
    </>
  );
}
