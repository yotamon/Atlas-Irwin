import { Field, Submit } from "./ui";
import { RELEASE_STATUSES, RELEASE_TYPES } from "@/lib/studio/constants";
import { saveReleaseV2 } from "@/app/studio/release-actions-v2";
import type { Release } from "@/types/database";

export function ReleaseForm({ release, releaseDateLocked = false }: { release?: Release; releaseDateLocked?: boolean }) {
  return (
    <form action={saveReleaseV2} className="studio-form studio-release-form-v2">
      <input type="hidden" name="id" value={release?.id} />
      {releaseDateLocked ? <input type="hidden" name="release_date" value={release?.release_date ?? ""} /> : null}
      <div className="studio-form-intro"><span className="section-label">Release essentials</span><h2>{release ? "What changed?" : "Give Atlas the minimum it needs"}</h2><p>Title, format and date are enough to create the workspace. Atlas manages the slug, workflow status, campaign window and release-relative schedule automatically.</p></div>
      <div className="form-grid release-essentials-grid">
        <Field label="Title" wide><input name="title" required autoFocus={!release} defaultValue={release?.title} /></Field>
        <Field label="Release type"><select name="release_type" defaultValue={release?.release_type || "Single"}>{RELEASE_TYPES.map((type) => <option key={type}>{type}</option>)}</select></Field>
        <Field label={releaseDateLocked ? "Release date (locked)" : "Release date"}><input type="date" name={releaseDateLocked ? undefined : "release_date"} disabled={releaseDateLocked} defaultValue={release?.release_date ?? ""} /></Field>
      </div>
      {releaseDateLocked ? <div className="v2-provider-lock" role="status"><strong>Release date is locked by an external schedule</strong><span>At least one approved post is already scheduled at a connected provider. Change or cancel that provider schedule before moving the release date so Atlas and the external channel cannot drift apart.</span></div> : <div className="studio-smart-defaults" role="note"><strong>Atlas handles the rest</strong><span>A release plan and campaign phases are created automatically. If the release date moves, unlocked scheduled content moves with it. No paid AI generation runs from this form.</span></div>}
      <details className="studio-advanced-details">
        <summary><span>Advanced details</span><small>Only change these when Atlas should not decide for you.</small></summary>
        <div className="form-grid studio-advanced-grid">
          <Field label="Workflow status"><select name="status" defaultValue={release?.status ?? ""}><option value="">Let Atlas manage</option>{RELEASE_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></Field>
          <Field label="Slug override"><input name="slug" pattern="[a-z0-9-]+" placeholder="Generated from title" defaultValue={release?.slug ?? ""} /></Field>
          <Field label="Core emotion"><input name="core_emotion" defaultValue={release?.core_emotion ?? ""} /></Field>
          <Field label="Audience"><input name="audience" defaultValue={release?.audience ?? ""} /></Field>
          <Field label="Primary hook" wide><input name="primary_hook" defaultValue={release?.primary_hook ?? ""} /></Field>
          <Field label="Visual direction" wide><textarea name="visual_direction" defaultValue={release?.visual_direction ?? ""} /></Field>
          <Field label="Color palette"><input name="color_palette" placeholder="Optional, comma separated" defaultValue={release?.color_palette?.join(", ")} /></Field>
          <Field label="Artwork URL"><input type="url" name="artwork_url" defaultValue={release?.artwork_url ?? ""} /></Field>
          <Field label="Private cover asset path"><input name="cover_asset" defaultValue={release?.cover_asset ?? ""} /></Field>
          <Field label="Spotify URL"><input type="url" name="spotify_url" defaultValue={release?.spotify_url ?? ""} /></Field>
          <Field label="SoundCloud URL"><input type="url" name="soundcloud_url" defaultValue={release?.soundcloud_url ?? ""} /></Field>
          <Field label="YouTube URL"><input type="url" name="youtube_url" defaultValue={release?.youtube_url ?? ""} /></Field>
          <Field label="Smart link URL"><input type="url" name="smart_link_url" defaultValue={release?.smart_link_url ?? ""} /></Field>
          <Field label="Public slug"><input name="public_slug" defaultValue={release?.public_slug ?? ""} /></Field>
          <Field label="Public release path" wide><input name="public_release_path" defaultValue={release?.public_release_path ?? ""} /></Field>
          <Field label="Release story" wide><textarea name="story" rows={5} defaultValue={release?.story ?? ""} /></Field>
          <Field label="Private notes" wide><textarea name="notes" rows={4} defaultValue={release?.notes ?? ""} /></Field>
        </div>
      </details>
      <div className="form-actions release-form-actions"><Submit>{release ? "Save changes" : "Create workspace"}</Submit></div>
    </form>
  );
}
