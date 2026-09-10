import {
  CONTENT_FORMATS,
  CONTENT_STATUSES,
  GOALS,
  PLATFORMS,
} from "@/lib/studio/constants";
import { saveContent } from "@/app/studio/actions";
import { Field, Submit } from "./ui";
import type { ContentItem } from "@/types/database";

function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

export function ContentForm({
  item,
  releases,
  defaultReleaseId,
}: {
  item?: ContentItem | null;
  releases: Array<{ id: string; title: string }>;
  defaultReleaseId?: string;
}) {
  const editing = Boolean(item);
  return (
    <form action={saveContent} className="studio-form" id={editing ? `edit-${item!.id}` : "new"}>
      {item ? <input type="hidden" name="id" value={item.id} /> : null}
      <div className="form-grid">
        <Field label="Title">
          <input name="title" required defaultValue={item?.title ?? ""} />
        </Field>
        <Field label="Release">
          <select name="release_id" defaultValue={item?.release_id ?? defaultReleaseId ?? ""}>
            <option value="">No release</option>
            {releases.map((release) => (
              <option key={release.id} value={release.id}>
                {release.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Platform">
          <select name="platform" defaultValue={item?.platform ?? PLATFORMS[0]}>
            {PLATFORMS.map((platform) => (
              <option key={platform}>{platform}</option>
            ))}
          </select>
        </Field>
        <Field label="Format">
          <select name="format" defaultValue={item?.format ?? CONTENT_FORMATS[0]}>
            {CONTENT_FORMATS.map((format) => (
              <option key={format}>{format}</option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select name="status" defaultValue={item?.status ?? CONTENT_STATUSES[0]}>
            {CONTENT_STATUSES.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </Field>
        <Field label="Goal">
          <select name="goal" defaultValue={item?.goal ?? GOALS[0]}>
            {GOALS.map((goal) => (
              <option key={goal}>{goal}</option>
            ))}
          </select>
        </Field>
        <Field label="Scheduled">
          <input type="datetime-local" name="scheduled_at" defaultValue={toLocalInput(item?.scheduled_at ?? null)} />
        </Field>
        <Field label="Published">
          <input type="datetime-local" name="published_at" defaultValue={toLocalInput(item?.published_at ?? null)} />
        </Field>
        <Field label="Audio start (seconds)">
          <input type="number" min="0" name="audio_timestamp_start" defaultValue={item?.audio_timestamp_start ?? ""} />
        </Field>
        <Field label="Audio end (seconds)">
          <input type="number" min="0" name="audio_timestamp_end" defaultValue={item?.audio_timestamp_end ?? ""} />
        </Field>
        <Field label="Hook" wide>
          <textarea name="hook_text" defaultValue={item?.hook_text ?? ""} />
        </Field>
        <Field label="Caption" wide>
          <textarea name="caption" rows={4} defaultValue={item?.caption ?? ""} />
        </Field>
        <Field label="CTA">
          <input name="cta" defaultValue={item?.cta ?? ""} />
        </Field>
        <Field label="Asset URL">
          <input name="asset_url" type="url" defaultValue={item?.asset_url ?? ""} />
        </Field>
        <Field label="Vertical visual prompt" wide>
          <textarea name="visual_prompt" rows={4} defaultValue={item?.visual_prompt ?? ""} />
        </Field>
        <Field label="Production notes" wide>
          <textarea name="production_notes" defaultValue={item?.production_notes ?? ""} />
        </Field>
        <Field label="Performance notes" wide>
          <textarea name="performance_notes" defaultValue={item?.performance_notes ?? ""} />
        </Field>
      </div>
      <Submit>{editing ? "Save content" : "Create content"}</Submit>
    </form>
  );
}
