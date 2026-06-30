import { notFound } from "next/navigation";
import { requireStudioAdmin } from "@/lib/auth/studio";
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
  PageHeader,
  Panel,
  Status,
  Submit,
} from "@/components/studio/ui";
import { READINESS_ITEMS } from "@/lib/studio/constants";
import type { Json } from "@/types/database";
export default async function ReleaseDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase } = await requireStudioAdmin();
  const [
    { data: release },
    { data: tracks },
    { count: contentCount },
    { count: contactCount },
  ] = await Promise.all([
    supabase.from("releases").select("*").eq("id", id).single(),
    supabase
      .from("tracks")
      .select("*")
      .eq("release_id", id)
      .order("is_primary", { ascending: false }),
    supabase
      .from("content_items")
      .select("id", { count: "exact", head: true })
      .eq("release_id", id),
    supabase
      .from("outreach_messages")
      .select("id", { count: "exact", head: true })
      .eq("release_id", id),
  ]);
  if (!release) notFound();
  const readiness = (release.readiness ?? {}) as Record<string, boolean>;
  const automated: Record<string, boolean> = {
    Artwork: Boolean(release.artwork_url || release.cover_asset),
    "Smart link": Boolean(release.smart_link_url),
    "Release story": Boolean(release.story),
    "At least 6 content pieces": (contentCount ?? 0) >= 6,
    "Outreach list": (contactCount ?? 0) > 0,
    "At least 10 outreach targets": (contactCount ?? 0) >= 10,
  };
  const completed = READINESS_ITEMS.filter(
    (item) => readiness[item] || automated[item],
  ).length;
  const identity = (release.release_identity ?? {}) as Record<string, Json>;
  const answers = (release.story_answers ?? {}) as Record<string, string>;
  return (
    <>
      <PageHeader
        title={release.title}
        description={`${release.release_type} · ${release.release_date ? new Date(release.release_date).toLocaleDateString() : "Date open"}`}
        action={
          <div className="actions">
            <Status>{release.status}</Status>
            <form action={generateContentPack}>
              <input type="hidden" name="id" value={id} />
              <button className="button primary">Generate content pack</button>
            </form>
          </div>
        }
      />
      <div className="studio-grid">
        <Panel title="Readiness" className="feature">
          <div className="progress">
            <span
              style={{
                width: `${Math.round((completed / READINESS_ITEMS.length) * 100)}%`,
              }}
            />
          </div>
          <p>
            {completed} of {READINESS_ITEMS.length} complete
          </p>
          <form action={updateReadiness} className="checklist">
            <input type="hidden" name="id" value={id} />
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
        <Panel title="Public site sync status">
          <p>
            {release.public_release_path ? (
              <>
                Linked to <strong>{release.public_release_path}</strong>. Sync
                remains manual and never rewrites the public manifest.
              </>
            ) : (
              "This release is Studio-only. Add a public slug/path when it has a matching public manifest."
            )}
          </p>
        </Panel>
      </div>
      <Panel title="Release information" className="feature">
        <ReleaseForm release={release} />
        <form action={saveCoverAsset} className="form-actions">
          <input type="hidden" name="id" value={id} />
          <AssetUpload folder={`releases/${id}`} />
          <button className="button">Attach uploaded cover</button>
        </form>
        <form action={deleteRelease}>
          <input type="hidden" name="id" value={id} />
          <button className="text-button">Delete release</button>
        </form>
      </Panel>
      <Panel title="Release story builder" className="feature">
        <form action={generateIdentity} className="studio-form">
          <input type="hidden" name="id" value={id} />
          <div className="form-grid">
            <Field
              label="What emotional moment does this track represent?"
              wide
            >
              <textarea
                name="emotional_moment"
                defaultValue={answers.emotional_moment}
              />
            </Field>
            <Field label="What makes it musically distinctive?" wide>
              <textarea
                name="musical_distinction"
                defaultValue={answers.musical_distinction}
              />
            </Field>
            <Field label="Where does it exist visually?">
              <textarea
                name="visual_world"
                defaultValue={answers.visual_world}
              />
            </Field>
            <Field label="Who is likely to connect?">
              <textarea
                name="likely_listener"
                defaultValue={answers.likely_listener}
              />
            </Field>
            <Field label="What should listeners feel?">
              <textarea
                name="listener_feeling"
                defaultValue={answers.listener_feeling}
              />
            </Field>
            <Field label="Should AI be part of the narrative?">
              <textarea
                name="ai_narrative"
                defaultValue={answers.ai_narrative}
              />
            </Field>
            <Field label="What should never be said?" wide>
              <textarea name="exclusions" defaultValue={answers.exclusions} />
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
            {Object.entries(identity)
              .filter(([k, v]) => k !== "oneLineIdentity" && Array.isArray(v))
              .map(([key, items]) => (
                <article key={key}>
                  <h3>{key.replace(/([A-Z])/g, " $1")}</h3>
                  <ul>
                    {(items as Json[]).map((x, i) => (
                      <li key={i}>{String(x)}</li>
                    ))}
                  </ul>
                </article>
              ))}
          </div>
        )}
      </Panel>
      <Panel title="Tracks" className="feature">
        {tracks?.length ? (
          <table className="studio-table">
            <thead>
              <tr>
                <th>Track</th>
                <th>Version</th>
                <th>Duration</th>
                <th>Primary</th>
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
          <p>No tracks added yet.</p>
        )}
        <form action={saveTrack} className="studio-form">
          <input type="hidden" name="release_id" value={id} />
          <div className="form-grid">
            <Field label="Track title">
              <input name="title" required />
            </Field>
            <Field label="Version">
              <input name="version" />
            </Field>
            <Field label="Duration (seconds)">
              <input type="number" min="0" name="duration" />
            </Field>
            <Field label="Audio / storage URL">
              <input name="audio_url" />
            </Field>
            <Field label="SoundCloud URL">
              <input name="soundcloud_url" />
            </Field>
            <Field label="Spotify URL">
              <input name="spotify_url" />
            </Field>
            <Field label="Primary track">
              <input type="checkbox" name="is_primary" />
            </Field>
            <Field label="Notes">
              <input name="notes" />
            </Field>
          </div>
          <Submit>Add track</Submit>
        </form>
      </Panel>
    </>
  );
}
