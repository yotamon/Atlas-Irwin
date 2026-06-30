import { Field, Submit } from "./ui";
import { RELEASE_STATUSES, RELEASE_TYPES } from "@/lib/studio/constants";
import { saveRelease } from "@/app/studio/actions";
import type { Release } from "@/types/database";
export function ReleaseForm({ release }: { release?: Release }) {
  return (
    <form action={saveRelease} className="studio-form">
      <input type="hidden" name="id" value={release?.id} />
      <div className="form-grid">
        <Field label="Title">
          <input name="title" required defaultValue={release?.title} />
        </Field>
        <Field label="Slug">
          <input
            name="slug"
            required
            pattern="[a-z0-9-]+"
            defaultValue={release?.slug}
          />
        </Field>
        <Field label="Release type">
          <select name="release_type" defaultValue={release?.release_type}>
            {RELEASE_TYPES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select name="status" defaultValue={release?.status}>
            {RELEASE_STATUSES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <Field label="Release date">
          <input
            type="date"
            name="release_date"
            defaultValue={release?.release_date ?? ""}
          />
        </Field>
        <Field label="Core emotion">
          <input
            name="core_emotion"
            defaultValue={release?.core_emotion ?? ""}
          />
        </Field>
        <Field label="Audience">
          <input name="audience" defaultValue={release?.audience ?? ""} />
        </Field>
        <Field label="Primary hook">
          <input
            name="primary_hook"
            defaultValue={release?.primary_hook ?? ""}
          />
        </Field>
        <Field label="Visual direction" wide>
          <textarea
            name="visual_direction"
            defaultValue={release?.visual_direction ?? ""}
          />
        </Field>
        <Field label="Color palette (comma-separated)">
          <input
            name="color_palette"
            defaultValue={release?.color_palette?.join(", ")}
          />
        </Field>
        <Field label="Artwork URL">
          <input
            type="url"
            name="artwork_url"
            defaultValue={release?.artwork_url ?? ""}
          />
        </Field>
        <Field label="Private cover asset path">
          <input name="cover_asset" defaultValue={release?.cover_asset ?? ""} />
        </Field>
        <Field label="Spotify URL">
          <input
            type="url"
            name="spotify_url"
            defaultValue={release?.spotify_url ?? ""}
          />
        </Field>
        <Field label="SoundCloud URL">
          <input
            type="url"
            name="soundcloud_url"
            defaultValue={release?.soundcloud_url ?? ""}
          />
        </Field>
        <Field label="YouTube URL">
          <input
            type="url"
            name="youtube_url"
            defaultValue={release?.youtube_url ?? ""}
          />
        </Field>
        <Field label="Smart link URL">
          <input
            type="url"
            name="smart_link_url"
            defaultValue={release?.smart_link_url ?? ""}
          />
        </Field>
        <Field label="Public slug">
          <input name="public_slug" defaultValue={release?.public_slug ?? ""} />
        </Field>
        <Field label="Public release path">
          <input
            name="public_release_path"
            defaultValue={release?.public_release_path ?? ""}
          />
        </Field>
        <Field label="Release story" wide>
          <textarea name="story" rows={5} defaultValue={release?.story ?? ""} />
        </Field>
        <Field label="Notes" wide>
          <textarea name="notes" rows={4} defaultValue={release?.notes ?? ""} />
        </Field>
      </div>
      <div className="form-actions">
        <Submit>{release ? "Save release" : "Create release"}</Submit>
      </div>
    </form>
  );
}
