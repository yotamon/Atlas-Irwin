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
import { AI_PRICING_AS_OF, CREATIVE_PRESETS } from "@/lib/marketing/creative-provider-catalog";
import { creativeProviderReadiness } from "@/lib/marketing/creative-providers";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { CONTENT_FORMATS, GOALS, PLATFORMS } from "@/lib/studio/constants";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { asMomentAwareMarketingClient, asMomentsClient } from "@/lib/studio/moments-db";
import { higgsfieldReadiness } from "@/lib/video-providers/higgsfield/client";
import type { Json } from "@/types/database";
import type { VideoDatabase } from "@/types/video-database";

function shortDate(value: string | null | undefined) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }).format(new Date(value));
}

function momentTime(ms: number) {
  const total = Math.max(0, ms) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = Math.floor(total % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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

function boolValue(value: unknown) {
  return value === true;
}

function quoteLabel(quote: Record<string, unknown>) {
  const amount = numberValue(quote.amount);
  const reserve = numberValue(quote.reserveAmount);
  const usd = numberValue(quote.usdEstimate);
  const currency = stringValue(quote.currency);
  const exact = boolValue(quote.exact);
  if (currency === "USD" && amount !== null) return `${exact ? "Estimated provider cost" : "Estimated from"} $${amount.toFixed(amount < 0.1 ? 4 : 2)}${reserve !== null && reserve > amount ? ` · max reserve $${reserve.toFixed(2)}` : ""}`;
  if (currency === "CREDITS" && amount !== null) return `${exact ? "Provider quote" : "Planning estimate"} ${amount.toFixed(2)} credits${reserve !== null ? ` · reserve ${reserve.toFixed(2)}` : ""}${usd !== null ? ` · about $${usd.toFixed(2)}` : ""}`;
  return "Price unavailable";
}

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; release?: string; moment?: string; saved?: string }>;
}) {
  const params = await searchParams;
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const music = asArtistScopedMusicClient(supabase);
  const marketing = asMomentAwareMarketingClient(supabase);
  const momentsDb = asMomentsClient(supabase);
  const [itemsResult, releasesResult] = await Promise.all([
    marketing.from("content_items").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).order("updated_at", { ascending: false }).limit(100),
    music.from("releases").select("id,title,release_date").eq("owner_id", user.id).eq("artist_id", artist.artistId).order("updated_at", { ascending: false }),
  ]);
  if (itemsResult.error) throw new Error(itemsResult.error.message);
  if (releasesResult.error) throw new Error(releasesResult.error.message);

  const allItems = itemsResult.data ?? [];
  const releases = releasesResult.data ?? [];
  const editing = params.edit ? allItems.find((item) => item.id === params.edit) ?? null : null;

  let selectedMoment = null;
  const lineageMomentId = editing?.moment_id ?? params.moment ?? null;
  if (lineageMomentId) {
    const { data, error } = await momentsDb
      .from("moments")
      .select("*")
      .eq("id", lineageMomentId)
      .eq("artist_id", artist.artistId)
      .single();
    if (error || !data) throw new Error(error?.message || "Moment not found for the active Artist.");
    if (!editing && data.state !== "approved") throw new Error("Only approved Moments can start new creative execution.");
    if (!editing && params.release && data.release_id !== params.release) throw new Error("Moment does not belong to the requested Release.");
    selectedMoment = data;
  } else if (!editing && params.release) {
    const { data, error } = await momentsDb
      .from("moments")
      .select("*")
      .eq("release_id", params.release)
      .eq("artist_id", artist.artistId)
      .eq("state", "approved")
      .order("confidence", { ascending: false })
      .order("start_ms", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    selectedMoment = data;
  }

  const selectedRelease = editing?.release_id ?? selectedMoment?.release_id ?? params.release ?? "";
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
          .eq("artist_id", artist.artistId)
          .eq("content_item_id", editing.id)
          .eq("status", "provider_scheduled" as never)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        marketing
          .from("generation_runs")
          .select("*")
          .eq("owner_id", user.id)
          .eq("artist_id", artist.artistId)
          .eq("purpose", `content_asset:${editing.id}`)
          .order("created_at", { ascending: false })
          .limit(8),
        loadCreativeReferenceContext({
          db: supabase as unknown as SupabaseClient<VideoDatabase>,
          ownerId: user.id,
          artistId: artist.artistId,
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
  const routeReason = stringValue(generationOutput.routeReason);
  const generationStage = stringValue(generationOutput.stage);
  const generatedOutputKind = stringValue(generationInput.outputKind);
  const selectedQuality = stringValue(generationInput.quality);
  const actualCostUsd = numberValue(generationOutput.actualCostUsd);
  const providerConnections = creativeProviderReadiness();
  const activeProvider = latestGeneration ? providerConnections.find((provider) => provider.id === latestGeneration.provider) : null;
  const hfReadiness = higgsfieldReadiness();
  const modelReady = latestGeneration
    ? Boolean(activeProvider?.configured) && (latestGeneration.provider !== "higgsfield" || hfReadiness.inferredEndpointsEnabled || hfReadiness.configuredModels.includes(latestGeneration.model))
    : true;

  return (
    <div className="studio-v2-page">
      <PageHeader
        title="Production"
        description={`Ensemblis turns approved ${artist.artistName} musical Moments into traceable campaign creative, then keeps the provider route and price visible before any paid generation.`}
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
                  <div><Status>{item.status}</Status><strong>{item.title}</strong><small>{item.platform} · {item.format}{item.moment_id ? " · Moment-linked" : ""}</small></div>
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
                Ensemblis already handed this exact creative and timing to the connected provider{providerSchedule.scheduled_at ? ` for ${shortDate(providerSchedule.scheduled_at)}` : ""}.
                Creative and schedule edits are locked here to prevent publishing a different version than the one you approved.
              </span>
              {providerSchedule.external_url ? <a href={providerSchedule.external_url} target="_blank" rel="noreferrer">Open provider item ↗</a> : null}
            </div>
          ) : null}

          {selectedMoment ? (
            <div className="studio-smart-defaults" role="note">
              <strong>{editing ? "Moment lineage" : "Starting from approved Moment"} · {selectedMoment.label}</strong>
              <span>{selectedMoment.source_mode.replaceAll("_", " ")} · {momentTime(selectedMoment.start_ms)}–{momentTime(selectedMoment.end_ms)} · {Math.round(selectedMoment.confidence * 100)} confidence · {selectedMoment.state}. This Moment ID remains attached to the creative so campaign and performance learning can trace back to the exact musical evidence.</span>
              <small>Source timing remains immutable even if this content item later uses a custom cut.</small>
            </div>
          ) : !editing && selectedRelease ? (
            <div className="v2-calm-state compact">
              <strong>No approved Moment yet.</strong>
              <p>You can still create manually, but Ensemblis will not invent a musical starting point. Review the release intelligence first if you want Moment-based generation and attribution.</p>
              <Link className="button" href={`/studio/releases/${selectedRelease}?stage=create#moments`}>Review release Moments</Link>
            </div>
          ) : null}

          {editing && !locked && creativeContext ? (
            <section className="studio-panel feature">
              <div className="panel-head">
                <div>
                  <span className="section-label">Ensemblis Creative Engine</span>
                  <h2>Generate cohesive media</h2>
                  <p>Choose the outcome-level quality preset. Ensemblis handles provider and model routing, but shows the exact route and expected spend before you approve it.</p>
                </div>
                <Status>{creativeContext.cohesionScore}/100 context cohesion</Status>
              </div>

              <div className="studio-smart-defaults">
                <strong>{creativeContext.release.artworkUrl ? "Release artwork is locked as the primary anchor" : "Artist-specific brand references are the primary anchor"}</strong>
                <span>{creativeContext.referenceSummary}. New media is instructed to extend this world rather than invent a fresh AI aesthetic.</span>
              </div>

              <div className="media-tags" aria-label="AI provider connections">
                {providerConnections.map((provider) => (
                  <span key={provider.id}>{provider.configured ? "●" : "○"} {provider.label} · {provider.configured ? "connected" : "not connected"}</span>
                ))}
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
              ) : <div className="v2-calm-state compact"><strong>No reusable image reference found.</strong><p>Add artist-specific reference media in Brand or attach artwork to this release before spending on generation.</p></div>}

              {latestGeneration ? (
                <div className="studio-smart-defaults">
                  <strong>{selectedQuality ? `${selectedQuality[0].toUpperCase()}${selectedQuality.slice(1)} · ` : ""}{latestGeneration.provider} / {latestGeneration.model} · {latestGeneration.status}</strong>
                  <span>{quoteLabel(quote)}{actualCostUsd !== null ? ` · recorded cost $${actualCostUsd.toFixed(2)}` : ""}. {routeReason || generationStage.replaceAll("_", " ")}</span>
                  {stringValue(quote.note) ? <small>{stringValue(quote.note)}</small> : null}
                </div>
              ) : null}

              {latestGeneration?.status === "queued" && generationStage === "prepared" ? (
                <div className="form-actions">
                  <form action={approvePreparedCreativeGeneration}>
                    <input type="hidden" name="artist_id" value={artist.artistId} />
                    <input type="hidden" name="generation_run_id" value={latestGeneration.id} />
                    <button className="button primary" type="submit" disabled={!modelReady}>Approve {quoteLabel(quote)} and generate</button>
                  </form>
                  <form action={discardPreparedCreativeGeneration}>
                    <input type="hidden" name="artist_id" value={artist.artistId} />
                    <input type="hidden" name="generation_run_id" value={latestGeneration.id} />
                    <button className="button" type="submit">Discard prepared run</button>
                  </form>
                  {!modelReady ? <small>{activeProvider?.label || latestGeneration.provider} is not fully connected for this model. Ensemblis will not guess credentials or paid endpoints.</small> : null}
                </div>
              ) : null}

              {latestGeneration?.status === "running" ? (
                <div className="form-actions">
                  <span>Generation is in progress at {activeProvider?.label || latestGeneration.provider}. Completed assets are imported into Media Library with full cost and visual lineage.</span>
                  {latestGeneration.provider_request_id ? (
                    <form action={refreshCreativeGeneration}>
                      <input type="hidden" name="artist_id" value={artist.artistId} />
                      <input type="hidden" name="generation_run_id" value={latestGeneration.id} />
                      <button className="button" type="submit">Check provider now</button>
                    </form>
                  ) : <small>Submission state is ambiguous, so Ensemblis will not retry and risk a duplicate paid generation.</small>}
                </div>
              ) : null}

              {latestGeneration?.status === "failed" ? (
                <div className="v2-provider-lock" role="status"><strong>Generation failed</strong><span>{latestGeneration.error || "The provider could not complete this creative."}</span></div>
              ) : null}

              {editing.asset_url && editing.source === "ai" ? (
                <div className="media-card">
                  <div className="media-thumb">
                    {generatedOutputKind === "video" ? <video src={editing.asset_url} controls playsInline preload="metadata" /> : <img src={editing.asset_url} alt={`Generated ${artist.artistName} campaign creative`} />}
                  </div>
                  <div className="media-card-body">
                    <span className="section-label">AI creative review</span>
                    <h3>{editing.approval_status === "approved" ? "Approved creative" : editing.approval_status === "rejected" ? "Rejected creative" : "Review before publishing"}</h3>
                    <p>This asset is stored in the Media Library with its release artwork, artist-specific references, provider, model, cost and generation lineage.</p>
                    {editing.approval_status === "pending" ? (
                      <div className="form-actions">
                        <form action={approveGeneratedCreative}><input type="hidden" name="artist_id" value={artist.artistId} /><input type="hidden" name="content_item_id" value={editing.id} /><button className="button primary" type="submit">Approve creative</button></form>
                        <form action={rejectGeneratedCreative}><input type="hidden" name="artist_id" value={artist.artistId} /><input type="hidden" name="content_item_id" value={editing.id} /><button className="button" type="submit">Reject</button></form>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {(!latestGeneration || latestGeneration.status === "completed" || latestGeneration.status === "failed") ? (
                <form action={prepareContentCreativeGeneration} className="studio-form">
                  <input type="hidden" name="artist_id" value={artist.artistId} />
                  <input type="hidden" name="content_item_id" value={editing.id} />
                  <fieldset>
                    <legend><strong>Generation quality</strong></legend>
                    <div className="v2-status-grid">
                      {(Object.entries(CREATIVE_PRESETS) as Array<[keyof typeof CREATIVE_PRESETS, (typeof CREATIVE_PRESETS)[keyof typeof CREATIVE_PRESETS]]>).map(([id, preset]) => (
                        <label key={id}>
                          <input type="radio" name="quality" value={id} defaultChecked={id === "balanced"} />
                          <strong>{preset.label}</strong>
                          <span>{preset.shortLabel}</span>
                          <small>{preset.description}</small>
                          <small>Image: {preset.imagePrice}</small>
                          <small>Video: {preset.videoPrice}</small>
                          <small>Planning: {preset.textStack}</small>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div className="form-grid">
                    <Field label="Media type"><select name="media_kind" defaultValue="auto"><option value="auto">Auto from content format</option><option value="image">Image</option><option value="video">Video</option></select></Field>
                  </div>
                  <div className="form-actions"><button className="button primary" type="submit">{editing.asset_url && editing.source === "ai" ? "Price another option" : "Show exact route and price"}</button></div>
                  <small>Price check is free. Ensemblis chooses the first connected model inside the preset, shows any fallback, and requires a second explicit approval before the paid call. Pricing anchors last verified {AI_PRICING_AS_OF}.</small>
                </form>
              ) : null}
            </section>
          ) : null}

          {editing && !locked ? (
            <div className="v2-contextual-upload">
              <div><strong>{editing.asset_url ? "Replace or add creative media manually" : "Or upload the creative asset yourself"}</strong><small>Manual media remains a fallback. Uploading here attaches it to this content item and updates workflow state automatically.</small></div>
              <MediaUploader contentItemId={editing.id} releaseId={editing.release_id ?? undefined} artistId={artist.artistId} defaultRole="social_image" />
            </div>
          ) : null}

          <form action={saveContentV2} className="studio-form">
            <input type="hidden" name="artist_id" value={artist.artistId} />
            <input type="hidden" name="id" value={editing?.id ?? ""} />
            <input type="hidden" name="moment_id" value={editing?.moment_id ?? selectedMoment?.id ?? ""} />
            <fieldset className="v2-production-fieldset" disabled={locked}>
              <div className="form-grid">
                <Field label="Title" wide><input name="title" required defaultValue={editing?.title ?? (selectedMoment ? `${selectedMoment.label} creative` : "")} /></Field>
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

              {!editing ? <div className="studio-smart-defaults"><strong>Save once to enable generation or upload</strong><span>{selectedMoment ? "The approved Moment, exact audio window and campaign lineage will be persisted with this item." : "Ensemblis needs the content record first. After creation the editor becomes both an AI generation target and a contextual upload target."}</span></div> : null}
              <div className="studio-smart-defaults" role="note"><strong>Status is automatic</strong><span>Draft, In Production, Ready, Scheduled and Published follow the work itself. AI-generated media stays approval-gated even after the asset arrives.</span></div>

              <details className="studio-advanced-details">
                <summary><span>Creative details</span><small>Prompts, production notes and external asset overrides when you need precise control.</small></summary>
                <div className="form-grid studio-advanced-grid">
                  <Field label="External asset URL" wide><input type="url" name="asset_url_override" placeholder={editing?.asset_url || "Optional external override"} /></Field>
                  <Field label="Vertical visual prompt" wide><textarea name="visual_prompt" rows={4} defaultValue={editing?.visual_prompt ?? ""} /></Field>
                  <Field label="Production notes" wide><textarea name="production_notes" rows={3} defaultValue={editing?.production_notes ?? ""} /></Field>
                  <Field label="Performance notes" wide><textarea name="performance_notes" rows={3} defaultValue={editing?.performance_notes ?? ""} /></Field>
                  <Field label="Audio start"><input type="number" min="0" name="audio_timestamp_start" defaultValue={editing?.audio_timestamp_start ?? (selectedMoment ? Math.floor(selectedMoment.start_ms / 1000) : "")} /></Field>
                  <Field label="Audio end"><input type="number" min="0" name="audio_timestamp_end" defaultValue={editing?.audio_timestamp_end ?? (selectedMoment ? Math.ceil(selectedMoment.end_ms / 1000) : "")} /></Field>
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
