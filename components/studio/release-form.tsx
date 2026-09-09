"use client";

import { useActionState } from "react";
import { SelectField } from "./form-controls";
import { ActionBar, Field, FormGrid, Notice, Submit } from "./ui";
import { RELEASE_STATUSES, RELEASE_TYPES } from "@/lib/studio/constants";
import { saveReleaseV2WithState } from "@/app/studio/release-form-actions";
import { EMPTY_ACTION_FORM_STATE, firstActionFieldError } from "@/lib/studio/form-state";
import type { Release } from "@/types/database";

const RELEASE_TYPE_OPTIONS = RELEASE_TYPES.map((value) => ({ value, label: value }));
const RELEASE_STATUS_OPTIONS = [
  { value: "", label: "Let Ensemblis manage" },
  ...RELEASE_STATUSES.map((value) => ({ value, label: value })),
];

export function ReleaseForm({
  release,
  releaseDateLocked = false,
  artistName,
}: {
  release?: Release;
  releaseDateLocked?: boolean;
  artistName?: string;
}) {
  const subject = artistName || "this artist";
  const [state, formAction] = useActionState(saveReleaseV2WithState, EMPTY_ACTION_FORM_STATE);
  const error = (name: string) => firstActionFieldError(state, name);

  return (
    <form action={formAction} className="studio-form studio-release-form-v2">
      <input type="hidden" name="id" value={release?.id} />
      {releaseDateLocked ? <input type="hidden" name="release_date" value={release?.release_date ?? ""} /> : null}

      <div className="studio-form-intro">
        <span className="section-label">Release essentials</span>
        <h2>{release ? "What changed?" : `Give Ensemblis the minimum it needs for ${subject}`}</h2>
        <p>Title, format and date are enough to create the workspace. Ensemblis manages the slug, workflow status, campaign window and release-relative schedule automatically.</p>
      </div>

      {state.message ? <Notice tone="danger" role="alert">{state.message}</Notice> : null}

      <FormGrid className="release-essentials-grid">
        <Field label="Title" wide required error={error("title")}>
          <input name="title" required autoFocus={!release} aria-invalid={Boolean(error("title")) || undefined} defaultValue={release?.title} />
        </Field>
        <SelectField
          label="Release type"
          name="release_type"
          options={RELEASE_TYPE_OPTIONS}
          required
          error={error("release_type")}
          defaultValue={release?.release_type || "Single"}
        />
        <Field label={releaseDateLocked ? "Release date (locked)" : "Release date"}>
          <input type="date" name={releaseDateLocked ? undefined : "release_date"} disabled={releaseDateLocked} defaultValue={release?.release_date ?? ""} />
        </Field>
      </FormGrid>

      {releaseDateLocked ? (
        <div className="v2-provider-lock" role="status">
          <strong>Release date is locked by an external schedule</strong>
          <span>At least one approved post is already scheduled at a connected provider. Change or cancel that provider schedule before moving the release date so Ensemblis and the external channel cannot drift apart.</span>
        </div>
      ) : (
        <div className="studio-smart-defaults" role="note">
          <strong>Ensemblis handles the rest</strong>
          <span>A release plan and campaign phases are created automatically. If the release date moves, unlocked scheduled content moves with it. No paid AI generation runs from this form.</span>
        </div>
      )}

      <details className="studio-advanced-details">
        <summary><span>Advanced details</span><small>Only change these when Ensemblis should not decide for you.</small></summary>
        <FormGrid className="studio-advanced-grid">
          <SelectField label="Workflow status" name="status" options={RELEASE_STATUS_OPTIONS} defaultValue={release?.status ?? ""} />
          <Field label="Slug override" error={error("slug")}><input name="slug" pattern="[a-z0-9-]+" placeholder="Generated from title" aria-invalid={Boolean(error("slug")) || undefined} defaultValue={release?.slug ?? ""} /></Field>
          <Field label="Core emotion"><input name="core_emotion" defaultValue={release?.core_emotion ?? ""} /></Field>
          <Field label="Audience"><input name="audience" defaultValue={release?.audience ?? ""} /></Field>
          <Field label="Primary hook" wide><input name="primary_hook" defaultValue={release?.primary_hook ?? ""} /></Field>
          <Field label="Visual direction" wide><textarea name="visual_direction" defaultValue={release?.visual_direction ?? ""} /></Field>
          <Field label="Color palette"><input name="color_palette" placeholder="Optional, comma separated" defaultValue={release?.color_palette?.join(", ")} /></Field>
          <Field label="Artwork URL" error={error("artwork_url")}><input type="url" name="artwork_url" aria-invalid={Boolean(error("artwork_url")) || undefined} defaultValue={release?.artwork_url ?? ""} /></Field>
          <Field label="Private cover asset path"><input name="cover_asset" defaultValue={release?.cover_asset ?? ""} /></Field>
          <Field label="Spotify URL" error={error("spotify_url")}><input type="url" name="spotify_url" aria-invalid={Boolean(error("spotify_url")) || undefined} defaultValue={release?.spotify_url ?? ""} /></Field>
          <Field label="SoundCloud URL" error={error("soundcloud_url")}><input type="url" name="soundcloud_url" aria-invalid={Boolean(error("soundcloud_url")) || undefined} defaultValue={release?.soundcloud_url ?? ""} /></Field>
          <Field label="YouTube URL" error={error("youtube_url")}><input type="url" name="youtube_url" aria-invalid={Boolean(error("youtube_url")) || undefined} defaultValue={release?.youtube_url ?? ""} /></Field>
          <Field label="Smart link URL" error={error("smart_link_url")}><input type="url" name="smart_link_url" aria-invalid={Boolean(error("smart_link_url")) || undefined} defaultValue={release?.smart_link_url ?? ""} /></Field>
          <Field label="Public slug"><input name="public_slug" defaultValue={release?.public_slug ?? ""} /></Field>
          <Field label="Public release path" wide><input name="public_release_path" defaultValue={release?.public_release_path ?? ""} /></Field>
          <Field label="Release story" wide><textarea name="story" rows={5} defaultValue={release?.story ?? ""} /></Field>
          <Field label="Private notes" wide><textarea name="notes" rows={4} defaultValue={release?.notes ?? ""} /></Field>
        </FormGrid>
      </details>

      <ActionBar message={release ? "Changes stay inside this release workspace until a separate publish or distribution action." : "This creates the workspace only. Nothing is published, distributed or charged from this step."}>
        <Submit>{release ? "Save changes" : "Create workspace"}</Submit>
      </ActionBar>
    </form>
  );
}
