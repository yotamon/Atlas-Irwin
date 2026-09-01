import { FiActivity, FiLayers, FiMusic, FiRefreshCw, FiStar, FiTrash2 } from "react-icons/fi";
import {
  regenerateAudioScenes,
  removeTrackStem,
  renderAudioScenePreview,
  retryStemAnalysis,
  toggleAudioScenePin,
  updateStemIdentity,
} from "@/app/studio/stem-actions";
import { AnalysisAutoRefresh } from "@/components/studio/analysis-auto-refresh";
import { StemCustomMixer } from "@/components/studio/stem-custom-mixer";
import { StemUploader } from "@/components/studio/stem-uploader";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { loadStemIntelligence } from "@/lib/music-intelligence/stem-scenes";
import {
  STEM_CATEGORIES,
  STEM_CATEGORY_LABELS,
  sceneTypeLabel,
} from "@/lib/music-intelligence/stems";
import type { Json, Track } from "@/types/database";
import type { AudioScene, TrackStem } from "@/types/stem-database";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function metric(stem: TrackStem, key: string) {
  const summary = record(record(stem.analysis).summary);
  const value = summary[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}

function percent(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

function time(ms: number | null | undefined) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  const seconds = Math.max(0, Math.round(ms / 100) / 10);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String((seconds % 60).toFixed(seconds % 60 ? 1 : 0)).padStart(2, "0")}`;
}

function offset(value: number) {
  if (!value) return "0 ms";
  return `${value > 0 ? "+" : ""}${value} ms`;
}

function statusLabel(status: TrackStem["status"]) {
  return ({
    uploaded: "Uploaded",
    queued: "Queued",
    analyzing: "Analyzing",
    ready: "Ready",
    failed: "Needs retry",
    stale: "Old master",
  } satisfies Record<TrackStem["status"], string>)[status];
}

function sceneRationale(scene: AudioScene) {
  const reason = record(scene.rationale).reason;
  return typeof reason === "string" ? reason : scene.description || "Reusable stem-aware audio treatment.";
}

function activeStatuses(stems: TrackStem[], scenes: AudioScene[]) {
  return stems.some((stem) => stem.status === "queued" || stem.status === "analyzing")
    || scenes.some((scene) => scene.status === "rendering");
}

function StemMetric({ label, value }: { label: string; value: number | null }) {
  return <span className="stem-metric"><small>{label}</small><strong>{percent(value)}</strong></span>;
}

export async function StemIntelligencePanel({
  releaseId,
  track,
}: {
  releaseId: string;
  track: Track | null;
}) {
  if (!track?.audio_url) {
    return (
      <section className="v2-section v2-full-column stem-intelligence-panel" id="stem-intelligence">
        <div className="v2-section-heading">
          <div><span className="section-label">Stem Intelligence</span><h2>Audio Scenes unlock after the master</h2></div>
          <span className="v2-count">0</span>
        </div>
        <div className="v2-calm-state compact">
          <strong>Attach the canonical master first.</strong>
          <p>Atlas binds every stem analysis to the exact master so old layers can never silently drive a new version of the release.</p>
        </div>
      </section>
    );
  }

  const { supabase, user } = await requireStudioAdmin();
  const state = await loadStemIntelligence(supabase, user.id, track.id);
  const assetIds = [
    ...state.stems.map((stem) => stem.media_asset_id),
    ...state.scenes.map((scene) => scene.preview_asset_id).filter((id): id is string => Boolean(id)),
  ];
  const assetResult = assetIds.length
    ? await supabase.from("media_assets").select("id,public_url,mime_type").in("id", [...new Set(assetIds)]).eq("owner_id", user.id)
    : { data: [], error: null };
  if (assetResult.error) throw new Error(assetResult.error.message);
  const assetById = new Map((assetResult.data ?? []).map((asset) => [asset.id, asset]));
  const readyStems = state.stems.filter((stem) => stem.status === "ready" && stem.source_master_url === track.audio_url);
  const readyScenes = state.scenes.filter((scene) => scene.status !== "stale");
  const categoryCount = new Set(readyStems.map((stem) => stem.category)).size;
  const currentBound = state.stems.filter((stem) => stem.source_master_url === track.audio_url).length;
  const analyzing = activeStatuses(state.stems, state.scenes);
  const bestScene = readyScenes.find((scene) => scene.source === "system") ?? readyScenes[0] ?? null;

  return (
    <section className="v2-section v2-full-column stem-intelligence-panel" id="stem-intelligence">
      <AnalysisAutoRefresh active={analyzing} />
      <div className="v2-section-heading stem-intelligence-heading">
        <div>
          <span className="section-label">Stem Intelligence</span>
          <h2>{readyStems.length ? `${readyStems.length} musical layer${readyStems.length === 1 ? "" : "s"} Atlas can direct` : "Turn stems into reusable Audio Scenes"}</h2>
          <p>Atlas understands what each layer contributes, where it works best, and which mix treatment fits different kinds of media.</p>
        </div>
        <div className="stem-intelligence-summary">
          <span><strong>{readyStems.length}</strong><small>ready stems</small></span>
          <span><strong>{categoryCount}</strong><small>roles</small></span>
          <span><strong>{readyScenes.length}</strong><small>Audio Scenes</small></span>
        </div>
      </div>

      <div className="stem-principle-strip">
        <div><FiLayers /><span><strong>Non-destructive</strong><small>Original stems stay untouched</small></span></div>
        <div><FiActivity /><span><strong>Master-bound</strong><small>{currentBound}/{state.stems.length || 0} attached to this exact version</small></span></div>
        <div><FiMusic /><span><strong>Content-aware</strong><small>Scenes carry platform and campaign intent</small></span></div>
      </div>

      <details className="workspace-drawer stem-import-drawer" open={!state.stems.length}>
        <summary>{state.stems.length ? "Import more stems" : "Import stems from Suno or your DAW"}</summary>
        <p className="v2-muted-copy">Export synchronized stems from Suno, Cubase, Ableton, Logic, or another source and drop them together. Atlas recognizes common file names, verifies each layer against the current master, then builds scenes automatically as analyses finish.</p>
        <StemUploader trackId={track.id} />
      </details>

      {state.stems.length ? (
        <div className="stem-library">
          <div className="stem-subheading">
            <div><span className="section-label">Layer map</span><h3>What Atlas hears inside the track</h3></div>
            <form action={regenerateAudioScenes}>
              <input type="hidden" name="track_id" value={track.id} />
              <button type="submit" className="button"><FiRefreshCw /> Refresh smart scenes</button>
            </form>
          </div>

          <div className="stem-table" role="table" aria-label="Track stems">
            {state.stems.map((stem) => {
              const asset = assetById.get(stem.media_asset_id);
              const alignmentWarning = stem.status === "ready" && (stem.alignment_confidence ?? 0) < 0.45;
              return (
                <article className={`stem-row stem-status-${stem.status}`} key={stem.id} role="row">
                  <div className="stem-row-main">
                    <span className="stem-role-badge">{STEM_CATEGORY_LABELS[stem.category]}</span>
                    <div className="stem-row-title">
                      <strong>{stem.label}</strong>
                      <small>{stem.source_provider} · {statusLabel(stem.status)}{stem.duration_ms ? ` · ${time(stem.duration_ms)}` : ""}</small>
                    </div>
                    <span className={`stem-status-chip ${stem.status}`}>{statusLabel(stem.status)}</span>
                  </div>

                  {asset?.public_url && asset.mime_type?.startsWith("audio/") ? <audio controls preload="none" src={asset.public_url} /> : null}

                  <div className="stem-metrics">
                    <StemMetric label="Energy" value={metric(stem, "energy")} />
                    <StemMetric label="Hook" value={metric(stem, "hook_score")} />
                    <StemMetric label="Groove" value={metric(stem, "groove_score")} />
                    <StemMetric label="Loop" value={metric(stem, "loopability")} />
                    <span className="stem-metric"><small>Alignment</small><strong>{percent(stem.alignment_confidence)}</strong></span>
                    <span className="stem-metric"><small>Offset</small><strong>{offset(stem.offset_ms)}</strong></span>
                  </div>

                  {alignmentWarning ? <div className="notice compact-notice">Low alignment confidence. Listen before relying on this stem in a transition-heavy scene.</div> : null}
                  {stem.error ? <div className="notice compact-notice">{stem.error}</div> : null}

                  <details className="stem-row-controls">
                    <summary>Layer controls</summary>
                    <div className="stem-row-control-grid">
                      <form action={updateStemIdentity} className="stem-identity-form">
                        <input type="hidden" name="stem_id" value={stem.id} />
                        <label className="field"><span>Name</span><input name="label" defaultValue={stem.label} maxLength={120} required /></label>
                        <label className="field"><span>Role</span><select name="category" defaultValue={stem.category}>{STEM_CATEGORIES.map((category) => <option value={category} key={category}>{STEM_CATEGORY_LABELS[category]}</option>)}</select></label>
                        <button className="button" type="submit">Save layer</button>
                      </form>
                      <div className="stem-row-actions">
                        <form action={retryStemAnalysis}>
                          <input type="hidden" name="stem_id" value={stem.id} />
                          <button className="button" type="submit"><FiRefreshCw /> {stem.status === "stale" ? "Rebind to current master" : "Re-analyze"}</button>
                        </form>
                        <form action={removeTrackStem}>
                          <input type="hidden" name="stem_id" value={stem.id} />
                          <button className="button danger" type="submit"><FiTrash2 /> Remove from track</button>
                        </form>
                      </div>
                    </div>
                  </details>
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="v2-calm-state compact">
          <strong>No stems yet.</strong>
          <p>The master already powers Track Intelligence. Add stems when you want Atlas to control which musical layers become foreground, background, reveal, or payoff.</p>
        </div>
      )}

      {readyStems.length ? (
        <div className="audio-scenes-section">
          <div className="stem-subheading">
            <div><span className="section-label">Audio Scenes</span><h3>Ready-made musical treatments for media</h3><p>These are mix recipes, not duplicate files. Render only the previews you want to audition or use.</p></div>
          </div>

          {readyScenes.length ? (
            <div className="audio-scene-grid">
              {readyScenes.map((scene) => {
                const preview = scene.preview_asset_id ? assetById.get(scene.preview_asset_id) : null;
                return (
                  <article className={`audio-scene-card ${scene.is_pinned ? "pinned" : ""}`} key={scene.id}>
                    <div className="audio-scene-card-header">
                      <div><span>{scene.source === "system" ? sceneTypeLabel(scene.scene_type) : "Artist mix"}</span><h4>{scene.name}</h4></div>
                      <form action={toggleAudioScenePin}>
                        <input type="hidden" name="scene_id" value={scene.id} />
                        <button className={`icon-button ${scene.is_pinned ? "active" : ""}`} type="submit" aria-label={scene.is_pinned ? `Unpin ${scene.name}` : `Pin ${scene.name}`}><FiStar /></button>
                      </form>
                    </div>
                    <p>{scene.description}</p>
                    <div className="audio-scene-window"><strong>{time(scene.recommended_start_ms)} → {time(scene.recommended_end_ms)}</strong><span>{scene.score === null ? "Artist-defined" : `${Math.round(scene.score * 100)}% fit`}</span></div>
                    <div className="audio-scene-tags">{scene.objective_tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}</div>
                    <small className="audio-scene-rationale">{sceneRationale(scene)}</small>
                    {preview?.public_url ? <audio controls preload="none" src={preview.public_url} /> : scene.status === "rendering" ? <div className="audio-scene-rendering">Rendering preview…</div> : null}
                    {scene.preview_error ? <div className="notice compact-notice">{scene.preview_error}</div> : null}
                    <form action={renderAudioScenePreview}>
                      <input type="hidden" name="scene_id" value={scene.id} />
                      <button className="button" type="submit" disabled={scene.status === "rendering"}>{preview?.public_url ? "Refresh preview" : "Render preview"}</button>
                    </form>
                  </article>
                );
              })}
            </div>
          ) : <div className="v2-calm-state compact"><strong>Smart scenes are forming.</strong><p>Atlas creates them incrementally as enough useful stems finish analysis.</p></div>}

          <details className="workspace-drawer stem-advanced-drawer">
            <summary>Advanced custom mixer</summary>
            <StemCustomMixer
              trackId={track.id}
              stems={readyStems.map((stem) => ({ id: stem.id, label: stem.label, category: stem.category }))}
              defaultStartMs={bestScene?.recommended_start_ms ?? 0}
              defaultEndMs={bestScene?.recommended_end_ms ?? 15000}
            />
          </details>
        </div>
      ) : null}
    </section>
  );
}
