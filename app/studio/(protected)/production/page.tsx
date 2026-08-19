/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MediaUploader } from "@/components/studio/media-uploader";
import { saveContentV2 } from "@/app/studio/content-actions-v2";
import {
  approveGeneratedCreative,
  approvePreparedCreativeGeneration,
  discardPreparedCreativeGeneration,
  prepareContentCreativeGeneration,
  refreshCreativeGeneration,
  rejectGeneratedCreative,
} from "@/app/studio/marketing-creative-actions";
import { Field, PageHeader, Status, Submit } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { loadCreativeReferenceContext } from "@/lib/marketing/creative-context";
import { asMarketingClient } from "@/lib/marketing/db";
import { CONTENT_FORMATS, GOALS, PLATFORMS } from "@/lib/studio/constants";
import { higgsfieldReadiness } from "@/lib/video-providers/higgsfield/client";
import type { Json } from "@/types/database";
import type { VideoDatabase } from "@/types/video-database";

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

function objectValue(value: Json | unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

  const [providerScheduleResult, generationRunsResult, creativeContext] = editing
    ? await Promise.all([
        marketing
          .from("publication_jobs")
          .select("id,platform,scheduled_at,external_url,external_post_id")
          .eq("owner_id", user.id)
          .eq("content_item_id", editing.id)
          .eq("status", "provider_scheduled" as never)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        marketing
          .from("generation_runs")
          .select("*")
          .eq("owner_id", user.id)
          .eq("purpose", `content_asset:${editing.id}`)
          .order("created_at", { ascending: false })
          .limit(8),
        loadCreativeReferenceContext({
          db: supabase as unknown as SupabaseClient<VideoDatabase>,
          ownerId: user.id,
          releaseId: editing.release_id,
          contentItemId: editing.id,
        }),
      ])
    : [{ data: null, error: null }, { data: [], error: null }, null] as const;
  if (providerScheduleResult.error) throw new Error(providerScheduleResult.error.message);
  if (generationRunsResult.error) throw new Error(generationRunsResult.error.message);
  const providerSchedule = providerScheduleResult.data;
  const locked = Boolean(providerSchedule);
  const generationRuns = generationRunsResult.data ?? [];
  const latestGeneration = generationRuns[0] ?? null;
  const generationOutput = objectValue(latestGeneration?.output);
  const generationInput = objectValue(latestGeneration?.input_context);
  const quote = objectValue(generationOutput.quote);
  const quoteCredits = numberValue(quote.credits);
  const reserveCredits = numberValue(quote.reserveCredits);
  const routeReason = stringValue(generationOutput.routeReason);
  const generationStage = stringValue(generationOutput.stage);
  const generatedOutputKind = stringValue(generationInput.outputKind);
  const providerReadiness = higgsfieldReadiness();
  const modelReady = latestGeneration
    ? providerReadiness.hasCredentials && (providerReadiness.inferredEndpointsEnabled || providerReadiness.configuredModels.includes(latestGeneration.model))
    : providerReadiness.hasCredentials;

  return (
    <div className="studio-v2-page">
      <PageHeader
        title="Production"
        description="Atlas can now make the creative itself. Every AI asset inherits the release artwork, Atlas Irwin brand references and approved visual language before it reaches you for review."
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
          ) : <div className="v2-calm-state compact"><strong>No production queue yet.</strong><p>Create one item or let a release campaign create the starter timeline.</p></div>}
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

          {editing && !locked && creativeContext ? (
            <section className="studio-panel feature">
              <div className="panel-head">
                <div>
                  <span className="section-label">Atlas Creative Engine</span>
                  <h2>Generate cohesive media</h2>
                  <p>Atlas resolves visual lineage before choosing a model. No paid request is made until you approve the prepared generation.</p>
                </div>
                <Status>{creativeContext.cohesionScore}/100 context cohesion</Status>
              </div>

              <div className="studio-smart-defaults">
                <strong>{creativeContext.release.artworkUrl ? "Release artwork is locked as the primary anchor" : "Brand references are the primary anchor"}</strong>
                <span>{creativeContext.referenceSummary}. New media is instructed to extend this world rather than invent a fresh AI aesthetic.</span>
              </div>

              {creativeContext.imageReferences.length ? (
                <div className="media-grid" aria-label="AI creative image references">
                  {creativeContext.imageReferences.map((reference) => (
                    <article className="media-card" key={`${reference.assetId || reference.url}-${reference.role}`}>
                      <div className="media-thumb"><img src={reference.url} alt="" /></div>
                      <div className="media-card-body">
                        <span className="section-label">{reference.source} · {reference.role.replaceAll("_", " ")}</span>
                        <h3>{reference.title}</h3>
                        <p>{reference.reason}</p>
                      </div>
                    </article>
                  ))}
                </div>
              ) : <div className="v2-calm-state compact"><strong>No reusable image reference found.</strong><p>Add Atlas Irwin reference media in Brand or attach artwork to this release before spending on generation.</p></div>}

              {latestGeneration ? (
                <div className="studio-smart-defaults">
                  <strong>{latestGeneration.model} · {latestGeneration.status}</strong>
                  <span>{routeReason || generationStage.replaceAll("_", " ")}{reserveCredits !== null ? ` · estimated maximum ${reserveCredits.toFixed(2)} credits` : quoteCredits !== null ? ` · estimated ${quoteCredits.toFixed(2)} credits` : ""}</span>
                </div>
              ) : null}

              {latestGeneration?.status === "queued" && generationStage === "prepared" ? (
                <div className="form-actions">
                  <form action={approvePreparedCreativeGeneration}>
                    <input type="hidden" name="generation_run_id" value={latestGeneration.id} />
                    <button className="button primary" type="submit" disabled={!modelReady}>Approve cost and generate</button>
                  </form>
                  <form action={discardPreparedCreativeGeneration}>
                    <input type="hidden" name="generation_run_id" value={latestGeneration.id} />
                    <button className="button" type="submit">Discard prepared run</button>
                  </form>
                  {!modelReady ? <small>Higgsfield credentials or a verified endpoint mapping for this model are missing. Atlas will not guess a paid endpoint.</small> : null}
                </div>
              ) : null}

              {latestGeneration?.status === "running" ? (
                <div className="form-actions">
                  <span>Generation is in progress. The Higgsfield webhook will attach the result automatically when it completes.</span>
                  {latestGeneration.provider_request_id ? (
                    <form action={refreshCreativeGeneration}>
                      <input type="hidden" name="generation_run_id" value={latestGeneration.id} />
                      <button className="button" type="submit">Check provider now</button>
                    </form>
                  ) : <small>Submission state is ambiguous, so Atlas will not retry and risk a duplicate paid generation.</small>}
                </div>
              ) : null}

              {latestGeneration?.status === "failed" ? (
                <div className="v2-provider-lock" role="status"><strong>Generation failed</strong><span>{latestGeneration.error || "The provider could not complete this creative."}</span></div>
              ) : null}

              {editing.asset_url && editing.source === "ai" ? (
                <div className="media-card">
                  <div className="media-thumb">
                    {generatedOutputKind === "video" ? <video src={editing.asset_url} controls playsInline preload="metadata" /> : <img src={editing.asset_url} alt="Generated Atlas Irwin campaign creative" />}
                  </div>
                  <div className="media-card-body">
                    <span className="section-label">AI creative review</span>
                    <h3>{editing.approval_status === "approved" ? "Approved creative" : editing.approval_status === "rejected" ? "Rejected creative" : "Review before publishing"}</h3>
                    <p>This asset is stored in the Media Library with its release artwork, brand references, model and generation lineage.</p>
                    {editing.approval_status === "pending" ? (
                      <div className="form-actions">
                        <form action={approveGeneratedCreative}><input type="hidden" name="content_item_id" value={editing.id} /><button className="button primary" type="submit">Approve creative</button></form>
                        <form action={rejectGeneratedCreative}><input type="hidden" name="content_item_id" value={editing.id} /><button className="button" type="submit">Reject</button></form>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {(!latestGeneration || latestGeneration.status === "completed" || latestGeneration.status === "failed") ? (
                <form action={prepareContentCreativeGeneration} className="studio-form">
                  <input type="hidden" name="content_item_id" value={editing.id} />
                  <div className="form-grid">
                    <Field label="Quality"><select name="quality" defaultValue="balanced"><option value="economy">Economy · cheap iteration</option><option value="balanced">Balanced · recommended</option><option value="premium">Premium · strongest available route</option></select></Field>
                    <Field label="Media type"><select name="media_kind" defaultValue="auto"><option value="auto">Auto from format</option><option value="image">Image</option><option value="video">Video</option></select></Field>
                  </div>
                  <div className="form-actions"><button className="button primary" type="submit">{editing.asset_url && editing.source === "ai" ? "Prepare another option" : "Prepare AI creative"}</button></div>
                  <small>Preparing is free. Atlas only calculates the creative package, references, model choice and credit estimate. The paid provider call requires a second explicit approval.</small>
                </form>
              ) : null}
            </section>
          ) : null}

          {editing && !locked ? (
            <div className="v2-contextual-upload">
              <div><strong>{editing.asset_url ? "Replace or add creative media manually" : "Or upload the creative asset yourself"}</strong><small>Manual media remains a fallback. Uploading here attaches it to this content item and updates workflow state automatically.</small></div>
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

              {!editing ? <div className="studio-smart-defaults"><strong>Save once to enable generation or upload</strong><span>Atlas needs the content record first. After creation the editor becomes both an AI generation target and a contextual upload target.</span></div> : null}
              <div className="studio-smart-defaults" role="note"><strong>Status is automatic</strong><span>Draft, In Production, Ready, Scheduled and Published follow the work itself. AI-generated media stays approval-gated even after the asset arrives.</span></div>

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
