import Link from "next/link";
import { MediaUploader } from "@/components/studio/media-uploader";
import { saveContentV2 } from "@/app/studio/content-actions-v2";
import { Field, PageHeader, Status, Submit } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import { CONTENT_FORMATS, GOALS, PLATFORMS } from "@/lib/studio/constants";

function shortDate(value: string | null | undefined) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }).format(new Date(value));
}

function berlinDateTimeLocal(value: string | null | undefined) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
}

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; release?: string; saved?: string }>;
}) {
  const params = await searchParams;
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const [itemsResult, releasesResult] = await Promise.all([
    marketing.from("content_items").select("*").eq("owner_id", user.id).order("updated_at", { ascending: false }).limit(100),
    supabase.from("releases").select("id,title,release_date").eq("owner_id", user.id).order("updated_at", { ascending: false }),
  ]);
  if (itemsResult.error) throw new Error(itemsResult.error.message);
  if (releasesResult.error) throw new Error(releasesResult.error.message);

  const allItems = itemsResult.data ?? [];
  const releases = releasesResult.data ?? [];
  const editing = params.edit ? allItems.find((item) => item.id === params.edit) ?? null : null;
  const selectedRelease = editing?.release_id ?? params.release ?? "";
  const items = params.release ? allItems.filter((item) => item.release_id === params.release) : allItems;
  const creative = items.filter((item) => ["Draft", "In Production"].includes(item.status));
  const ready = items.filter((item) => item.status === "Ready");
  const scheduled = items.filter((item) => item.status === "Scheduled");
  const recentlyPublished = items.filter((item) => item.status === "Published").slice(0, 8);

  const { data: providerSchedule, error: providerError } = editing
    ? await marketing
        .from("publication_jobs")
        .select("id,platform,scheduled_at,external_url,external_post_id")
        .eq("owner_id", user.id)
        .eq("content_item_id", editing.id)
        .eq("status", "provider_scheduled" as never)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null, error: null };
  if (providerError) throw new Error(providerError.message);
  const locked = Boolean(providerSchedule);

  return (
    <div className="studio-v2-page">
      <PageHeader
        title="Production"
        description="Work on creative decisions. Atlas derives workflow state from the actual asset, copy, schedule and publication evidence."
        action={<Link className="button" href="/studio/content">Advanced Content Lab</Link>}
      />

      <section className="v2-status-grid">
        <article><strong>{creative.length}</strong><span>needs creative input</span><small>Draft or in production</small></article>
        <article><strong>{ready.length}</strong><span>ready</span><small>Creative and asset complete</small></article>
        <article><strong>{scheduled.length}</strong><span>scheduled</span><small>Publication approval or time</small></article>
        <article><strong>{recentlyPublished.length}</strong><span>recently published</span><small>Ready to learn from</small></article>
      </section>

      <div className="v2-production-layout">
        <section className="v2-section v2-compact-section">
          <div className="v2-section-heading">
            <div><span className="section-label">Queue</span><h2>What needs making</h2></div>
            <Link href={params.release ? `/studio/production?release=${params.release}` : "/studio/production"}>New item</Link>
          </div>
          {items.length ? (
            <div className="v2-production-list">
              {items.map((item) => (
                <Link className={editing?.id === item.id ? "active" : ""} href={`/studio/production?edit=${item.id}${params.release ? `&release=${params.release}` : ""}`} key={item.id}>
                  <div><Status>{item.status}</Status><strong>{item.title}</strong><small>{item.platform} · {item.format}</small></div>
                  <span>{item.scheduled_at ? shortDate(item.scheduled_at) : ""}</span>
                </Link>
              ))}
            </div>
          ) : <div className="v2-calm-state compact"><strong>No production queue yet.</strong><p>Create one item or let a release workspace create the starter timeline.</p></div>}
        </section>

        <section className="v2-section v2-production-editor">
          <div className="v2-section-heading">
            <div><span className="section-label">{editing ? "Edit" : "Create"}</span><h2>{editing ? editing.title : "New content moment"}</h2></div>
            {editing ? <Status>{editing.status}</Status> : null}
          </div>

          {providerSchedule ? (
            <div className="v2-provider-lock" role="status">
              <strong>Schedule owned by {providerSchedule.platform}</strong>
              <span>
                Atlas already handed this exact creative and timing to the connected provider{providerSchedule.scheduled_at ? ` for ${shortDate(providerSchedule.scheduled_at)}` : ""}.
                Creative and schedule edits are locked here to prevent publishing a different version than the one you approved.
              </span>
              {providerSchedule.external_url ? <a href={providerSchedule.external_url} target="_blank" rel="noreferrer">Open provider item ↗</a> : null}
            </div>
          ) : null}

          {editing && !locked ? (
            <div className="v2-contextual-upload">
              <div><strong>{editing.asset_url ? "Replace or add creative media" : "Add the creative asset"}</strong><small>Uploading here attaches the asset to this content item and updates its workflow state automatically.</small></div>
              <MediaUploader contentItemId={editing.id} releaseId={editing.release_id ?? undefined} defaultRole="social_image" />
            </div>
          ) : null}

          <form action={saveContentV2} className="studio-form">
            <input type="hidden" name="id" value={editing?.id ?? ""} />
            <fieldset className="v2-production-fieldset" disabled={locked}>
              <div className="form-grid">
                <Field label="Title" wide><input name="title" required defaultValue={editing?.title ?? ""} /></Field>
                <Field label="Release">
                  <select name="release_id" defaultValue={selectedRelease}>
                    <option value="">No release</option>
                    {releases.map((release) => <option value={release.id} key={release.id}>{release.title}</option>)}
                  </select>
                </Field>
                <Field label="Platform"><select name="platform" defaultValue={editing?.platform ?? "Instagram"}>{PLATFORMS.map((platform) => <option key={platform}>{platform}</option>)}</select></Field>
                <Field label="Format"><select name="format" defaultValue={editing?.format ?? "Reel"}>{CONTENT_FORMATS.map((format) => <option key={format}>{format}</option>)}</select></Field>
                <Field label="Goal"><select name="goal" defaultValue={editing?.goal ?? "Reach"}>{GOALS.map((goal) => <option key={goal}>{goal}</option>)}</select></Field>
                <Field label="Schedule"><input type="datetime-local" name="scheduled_at" defaultValue={berlinDateTimeLocal(editing?.scheduled_at)} /></Field>
                <Field label="Hook" wide><textarea name="hook_text" rows={2} defaultValue={editing?.hook_text ?? ""} /></Field>
                <Field label="Caption" wide><textarea name="caption" rows={5} defaultValue={editing?.caption ?? ""} /></Field>
                <Field label="CTA" wide><input name="cta" defaultValue={editing?.cta ?? ""} /></Field>
              </div>

              {!editing ? <div className="studio-smart-defaults"><strong>Save once to attach media</strong><span>Atlas needs the content record first. After creation the editor becomes a contextual upload target.</span></div> : null}
              <div className="studio-smart-defaults" role="note"><strong>Status is automatic</strong><span>Draft, In Production, Ready, Scheduled and Published follow the work itself. Uploading an asset can move the item forward without a manual card move.</span></div>

              <details className="studio-advanced-details">
                <summary><span>Creative details</span><small>Prompts, production notes and external asset overrides when you need precise control.</small></summary>
                <div className="form-grid studio-advanced-grid">
                  <Field label="External asset URL" wide><input type="url" name="asset_url_override" placeholder={editing?.asset_url || "Optional external override"} /></Field>
                  <Field label="Vertical visual prompt" wide><textarea name="visual_prompt" rows={4} defaultValue={editing?.visual_prompt ?? ""} /></Field>
                  <Field label="Production notes" wide><textarea name="production_notes" rows={3} defaultValue={editing?.production_notes ?? ""} /></Field>
                  <Field label="Performance notes" wide><textarea name="performance_notes" rows={3} defaultValue={editing?.performance_notes ?? ""} /></Field>
                  <Field label="Audio start"><input type="number" min="0" name="audio_timestamp_start" defaultValue={editing?.audio_timestamp_start ?? ""} /></Field>
                  <Field label="Audio end"><input type="number" min="0" name="audio_timestamp_end" defaultValue={editing?.audio_timestamp_end ?? ""} /></Field>
                </div>
              </details>
              <div className="form-actions"><Submit>{editing ? "Save creative" : "Create item"}</Submit></div>
            </fieldset>
          </form>
        </section>
      </div>
    </div>
  );
}
