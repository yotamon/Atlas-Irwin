/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import {
  analyzeMusicVideoTrack,
  approveAndGenerateLookDevelopment,
  approveAndGenerateNextProductionBatch,
  approveAndGenerateTestShots,
  approveLookReferences,
  approveTestShots,
  approveVideoProductionPlan,
  finalizeVideoShotReview,
  generateVideoConcepts,
  generateVideoProductionPlan,
  lockShotGeneration,
  refreshPendingVideoGenerations,
  rejectShotGeneration,
  renderVideoOutput,
  requestShotAlternative,
  reviseVideoShot,
  selectVideoConcept,
  useFallbackMusicAnalysis,
} from "@/app/studio/video-pipeline-actions";
import { SubmitButton } from "@/components/studio/submit-button";
import { Status } from "@/components/studio/ui";
import { parseMusicMap, type VideoConcept, type VisualBible } from "@/lib/video-director/creative-director";
import type { Json, MediaAsset } from "@/types/database";
import type { ExtendedMusicVideoGeneration, ExtendedMusicVideoShot } from "@/types/video-database";
import type { VideoWorkspaceData } from "./workspace-types";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function concept(value: Json): VideoConcept | null {
  const row = record(value);
  return typeof row.title === "string" && typeof row.premise === "string"
    ? row as unknown as VideoConcept
    : null;
}

function time(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function credits(value: number) {
  return `${Number(value || 0).toFixed(1)} cr`;
}

function assetMap(assets: MediaAsset[]) {
  return new Map(assets.map((asset) => [asset.id, asset]));
}

function quote(generation: ExtendedMusicVideoGeneration) {
  const metadata = record(generation.provider_metadata);
  return {
    expected: typeof metadata.quote_credits === "number" ? metadata.quote_credits : generation.estimated_credits,
    reserve: generation.estimated_credits,
    note: typeof metadata.quote_note === "string" ? metadata.quote_note : null,
  };
}

function isPending(generation: ExtendedMusicVideoGeneration) {
  return ["approved", "submitted", "queued", "in_progress"].includes(generation.status);
}

function verticalSafe(shot: ExtendedMusicVideoShot) {
  return record(shot.generation_params).vertical_safe === true;
}

function nextAction(status: VideoWorkspaceData["project"]["status"], data: VideoWorkspaceData) {
  const concepts = data.concepts.length;
  switch (status) {
    case "draft": return ["Understand the track", "Analyze its structure before making visual decisions.", "#music-map"] as const;
    case "analyzing_audio": return ["Music analysis is running", "The worker will return BPM, energy, sections and edit points. You can leave and come back safely.", "#music-map"] as const;
    case "concept_review": return concepts
      ? ["Choose the film", "Compare the creative directions and approve the one worth developing.", "#concepts"] as const
      : ["Create creative directions", "Generate three genuinely different concepts from the track and Atlas context.", "#concepts"] as const;
    case "treatment_review": return ["Turn the idea into a production", "Build the visual bible, timed storyboard, model routing and cost plan.", "#production-plan"] as const;
    case "production_plan_review": return ["Approve the production plan", "Review the visual system and cost envelope before any paid generation.", "#production-plan"] as const;
    case "look_dev": return ["Establish the world cheaply", "Generate reference stills before spending on motion.", "#look-development"] as const;
    case "look_review": return ["Lock the visual language", "Choose the reference frames that every video shot should inherit.", "#look-development"] as const;
    case "test_generation": return ["Validate before scaling", "Generate only the representative test shots and inspect them first.", "#generation"] as const;
    case "test_review": return ["Review the test shots", "Lock the winners or revise them before releasing the full production budget.", "#shot-review"] as const;
    case "production": return ["Produce in bounded batches", "Generate a small batch, review it, then continue. No automatic creative retries.", "#generation"] as const;
    case "shot_review": return ["Lock the final timeline sources", "Approve each source sequence before assembly.", "#shot-review"] as const;
    case "ready_to_render": return ["Assemble the master", "Atlas will cut the locked sources to the original master audio.", "#render"] as const;
    case "rendering": return ["Final render in progress", "The render job is durable. Leaving this page will not lose it.", "#render"] as const;
    case "complete": return ["Master complete", "Create social cuts and archive the final assets in the Media Library.", "#render"] as const;
    case "blocked": return ["Production needs attention", data.project.last_error || "Resolve the blocker, then continue from the last safe checkpoint.", "#services"] as const;
    case "failed": return ["Project stopped safely", data.project.last_error || "No additional spend will occur until you intervene.", "#services"] as const;
    case "archived": return ["Archived production", "History, assets and spend remain auditable. This project is read only.", "#brief"] as const;
  }
}

export function NextActionCard({ data }: { data: VideoWorkspaceData }) {
  const [title, body, href] = nextAction(data.project.status, data);
  return (
    <section className="video-next-action">
      <div>
        <span className="section-label">Director cue</span>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
      <Link className="button primary" href={href}>Go to next action</Link>
    </section>
  );
}

export function ServiceReadinessPanel({ data }: { data: VideoWorkspaceData }) {
  const { director, higgsfield, worker } = data.services;
  const higgsReady = higgsfield.hasCredentials && higgsfield.configuredModels.length > 0;
  return (
    <section className="workspace-section video-service-readiness" id="services">
      <div className="section-head">
        <div><span className="section-label">Production services</span><h2>Ready when each stage needs it</h2></div>
        <Status>{director.configured && higgsReady && worker.configured ? "All connected" : "Setup aware"}</Status>
      </div>
      <div className="video-service-grid">
        <article className={director.configured ? "ready" : "needs-setup"}>
          <span>{director.configured ? "Ready" : "Setup"}</span><strong>Creative Director</strong>
          <p>{director.configured ? `${director.model} structured planning is available.` : "Set OPENAI_API_KEY before generating concepts or revisions."}</p>
        </article>
        <article className={higgsReady ? "ready" : "needs-setup"}>
          <span>{higgsReady ? "Ready" : "Setup"}</span><strong>Higgsfield</strong>
          <p>{!higgsfield.hasCredentials
            ? "Set HF_CREDENTIALS before any paid generation."
            : higgsfield.configuredModels.length
              ? `${higgsfield.configuredModels.length} verified model endpoint${higgsfield.configuredModels.length === 1 ? "" : "s"} configured.`
              : "Credentials exist, but verified endpoint mappings are still required before paid generation."}</p>
        </article>
        <article className={worker.configured ? "ready" : "optional"}>
          <span>{worker.configured ? "Ready" : "Optional"}</span><strong>Media Worker</strong>
          <p>{worker.configured ? "Real audio analysis and FFmpeg rendering are connected." : "Planning can use estimated structure. Final rendering waits for the Cloud Run worker."}</p>
        </article>
      </div>
    </section>
  );
}

export function MusicMapPanel({ data }: { data: VideoWorkspaceData }) {
  const map = parseMusicMap(data.project.music_map);
  const notes = record(data.project.director_notes);
  const analyzing = data.project.status === "analyzing_audio";
  return (
    <section className="workspace-section video-music-map" id="music-map">
      <div className="section-head">
        <div><span className="section-label">Music intelligence</span><h2>The edit starts with the track</h2></div>
        {map ? <Status>{map.source === "worker" ? "Analyzed audio" : "Estimated map"}</Status> : <Status>Not analyzed</Status>}
      </div>
      {!map ? (
        <div className="video-action-empty">
          <div><h3>Map the music before directing it</h3><p>Atlas uses structure, energy and edit points to decide where the visual world should evolve.</p></div>
          <form action={analyzeMusicVideoTrack}>
            <input type="hidden" name="project_id" value={data.project.id} />
            <SubmitButton pendingLabel="Analyzing track...">Analyze track</SubmitButton>
          </form>
        </div>
      ) : (
        <>
          <div className="video-music-stats">
            <span><small>BPM</small><strong>{map.bpm ?? "Pending real analysis"}</strong></span>
            <span><small>Duration</small><strong>{time(map.duration_ms)}</strong></span>
            <span><small>Sections</small><strong>{map.sections.length}</strong></span>
            <span><small>Edit points</small><strong>{map.edit_points.length}</strong></span>
          </div>
          <div className="video-energy-chart" aria-label="Track energy curve">
            {map.energy_curve.slice(0, 90).map((point, index) => (
              <span key={`${point.ms}-${index}`} style={{ height: `${Math.max(8, point.value * 100)}%` }} title={`${time(point.ms)} - ${Math.round(point.value * 100)}% energy`} />
            ))}
          </div>
          <div className="video-section-timeline">
            {map.sections.map((section) => (
              <article key={section.id} style={{ width: `${Math.max(7, ((section.end_ms - section.start_ms) / map.duration_ms) * 100)}%` }}>
                <strong>{section.label}</strong><small>{time(section.start_ms)} - {time(section.end_ms)}</small><em>{Math.round(section.energy * 100)}%</em>
              </article>
            ))}
          </div>
          {typeof notes.analysis_note === "string" ? <p className="video-inline-note">{notes.analysis_note}</p> : null}
          {map.source === "fallback" && data.services.worker.configured ? (
            <form action={analyzeMusicVideoTrack} className="video-inline-action">
              <input type="hidden" name="project_id" value={data.project.id} />
              <SubmitButton pendingLabel="Running real analysis..." className="button">Replace with real audio analysis</SubmitButton>
            </form>
          ) : null}
        </>
      )}
      {analyzing ? (
        <div className="video-processing-card">
          <span className="video-pulse" /><div><strong>Audio analysis is running</strong><p>The job is persisted. Refresh whenever you want to check its result.</p></div>
          <Link className="button" href={`/studio/video/${data.project.id}`}>Refresh</Link>
          <form action={useFallbackMusicAnalysis}>
            <input type="hidden" name="project_id" value={data.project.id} />
            <SubmitButton className="text-button" pendingLabel="Switching...">Use estimated structure instead</SubmitButton>
          </form>
        </div>
      ) : null}
    </section>
  );
}

export function ConceptsPanel({ data }: { data: VideoWorkspaceData }) {
  const latestRound = Math.max(0, ...data.concepts.map((item) => item.round_number));
  const concepts = data.concepts.filter((item) => item.round_number === latestRound);
  const canGenerate = data.services.director.configured && Boolean(parseMusicMap(data.project.music_map));
  return (
    <section className="workspace-section" id="concepts">
      <div className="section-head">
        <div><span className="section-label">Creative direction</span><h2>Choose the film before buying footage</h2></div>
        {concepts.length ? <Status>Round {latestRound}</Status> : null}
      </div>
      {concepts.length ? (
        <div className="video-concept-grid">
          {concepts.map((row) => {
            const item = concept(row.concept_data);
            if (!item) return null;
            const selected = row.id === data.project.selected_concept_id || row.status === "selected";
            return (
              <article className={selected ? "video-concept-card selected" : "video-concept-card"} key={row.id}>
                <div className="video-concept-title"><span>{String(row.display_order + 1).padStart(2, "0")}</span><Status>{item.complexity} complexity</Status></div>
                <h3>{item.title}</h3><p className="video-concept-premise">{item.premise}</p>
                <dl><div><dt>World</dt><dd>{item.world}</dd></div><div><dt>Visual system</dt><dd>{item.visual_language}</dd></div><div><dt>Camera</dt><dd>{item.camera_language}</dd></div><div><dt>Motif</dt><dd>{item.recurring_motif}</dd></div></dl>
                <p><strong>Why it fits the music:</strong> {item.musical_fit}</p>
                <div className="video-avoid-list">{item.anti_cliches.slice(0, 5).map((avoid) => <span key={avoid}>Avoid: {avoid}</span>)}</div>
                {selected ? <div className="video-selected-banner">Approved direction</div> : (
                  <form action={selectVideoConcept}>
                    <input type="hidden" name="project_id" value={data.project.id} /><input type="hidden" name="concept_id" value={row.id} />
                    <SubmitButton pendingLabel="Selecting concept...">Choose this concept</SubmitButton>
                  </form>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="video-action-empty"><div><h3>Three directions, no video spend</h3><p>The Director will deliberately separate premise, visual mechanism and narrative progression instead of offering three color variants.</p></div></div>
      )}
      {data.project.status === "concept_review" ? (
        <form action={generateVideoConcepts} className="video-section-action">
          <input type="hidden" name="project_id" value={data.project.id} />
          <SubmitButton pendingLabel="Directing three concepts..." disabled={!canGenerate}>{concepts.length ? "Generate a new concept round" : "Generate 3 concepts"}</SubmitButton>
          {!data.services.director.configured ? <small>Creative Director setup is required first.</small> : null}
        </form>
      ) : null}
      {data.project.status === "treatment_review" && data.project.selected_concept_id ? (
        <form action={generateVideoProductionPlan} className="video-section-action">
          <input type="hidden" name="project_id" value={data.project.id} />
          <SubmitButton pendingLabel="Building treatment and storyboard..." disabled={!data.services.director.configured}>Build treatment + production plan</SubmitButton>
        </form>
      ) : null}
    </section>
  );
}

export function ProductionPlanPanel({ data }: { data: VideoWorkspaceData }) {
  const plan = record(data.project.production_plan);
  const cost = record(plan.cost_estimate);
  const bible = record(data.project.visual_bible) as unknown as Partial<VisualBible>;
  if (!Object.keys(plan).length) return null;
  const reserve = typeof cost.total_reserve_credits === "number" ? cost.total_reserve_credits : data.project.estimated_credits;
  const available = Number(data.project.hard_budget_credits) - Number(data.project.spent_credits) - Number(data.project.reserved_credits);
  const withinBudget = reserve <= available + 0.001;
  return (
    <section className="workspace-section" id="production-plan">
      <div className="section-head"><div><span className="section-label">Production plan</span><h2>A visual bible with a budget</h2></div><Status>{withinBudget ? "Within hard cap" : "Over hard cap"}</Status></div>
      <div className="video-plan-grid">
        <article className="video-bible-card"><small>World</small><h3>{bible.world || "Visual world"}</h3><p>{strings(bible.materials).join(" · ")}</p><div className="video-chip-list">{strings(bible.recurring_motifs).map((item) => <span key={item}>{item}</span>)}</div></article>
        <article><small>Camera rules</small><ul>{strings(bible.camera_rules).map((item) => <li key={item}>{item}</li>)}</ul></article>
        <article><small>Lighting + texture</small><ul>{[...strings(bible.lighting_rules), ...strings(bible.texture_rules)].slice(0, 8).map((item) => <li key={item}>{item}</li>)}</ul></article>
        <article className="video-do-not-card"><small>Do not drift into</small><ul>{strings(bible.avoid).map((item) => <li key={item}>{item}</li>)}</ul></article>
      </div>
      <div className="video-cost-plan">
        <div><small>Look development</small><strong>{credits(Number(cost.look_dev_credits || 0))}</strong></div>
        <div><small>Generated sources</small><strong>{credits(Number(cost.source_generation_credits || 0))}</strong></div>
        <div><small>Unique sequences</small><strong>{String(cost.unique_source_sequences ?? data.shots.length)}</strong></div>
        <div><small>Editorial reuse</small><strong>{String(cost.editorial_reuse_shots ?? 0)}</strong></div>
        <div className="total"><small>Conservative reserve</small><strong>{credits(reserve)}</strong><span>Hard cap: {credits(data.project.hard_budget_credits)}</span></div>
      </div>
      {data.project.status === "production_plan_review" ? (
        <form action={approveVideoProductionPlan} className="video-section-action">
          <input type="hidden" name="project_id" value={data.project.id} />
          <SubmitButton pendingLabel="Preparing look development..." disabled={!withinBudget}>Approve plan and prepare look development</SubmitButton>
          {!withinBudget ? <small>Raise the hard budget in the Brief or regenerate a leaner plan before proceeding.</small> : <small>This approval spends 0 credits. Look generation gets its own explicit spend approval next.</small>}
        </form>
      ) : null}
    </section>
  );
}

export function StoryboardPanel({ data }: { data: VideoWorkspaceData }) {
  if (!data.scenes.length || !data.shots.length) return null;
  const plan = record(data.project.production_plan);
  const tests = new Set(Array.isArray(plan.test_shot_indexes) ? plan.test_shot_indexes.filter((item): item is number => typeof item === "number") : []);
  const duration = Math.max(1, data.shots.at(-1)?.end_ms ?? 1);
  return (
    <section className="workspace-section" id="storyboard">
      <div className="section-head"><div><span className="section-label">Storyboard</span><h2>{data.shots.length} timeline decisions, fewer paid sources</h2></div><span>{data.scenes.length} scenes</span></div>
      <div className="video-shot-strip">
        {data.shots.map((shot) => (
          <span key={shot.id} className={`shot-${shot.status}`} style={{ width: `${Math.max(1.5, ((shot.end_ms - shot.start_ms) / duration) * 100)}%` }} title={`Shot ${shot.display_order + 1}: ${shot.description}`} />
        ))}
      </div>
      <div className="video-storyboard-scenes">
        {data.scenes.map((scene) => (
          <article key={scene.id}>
            <header><div><span>{time(scene.start_ms)} - {time(scene.end_ms)}</span><h3>{scene.title}</h3></div><p>{scene.description}</p></header>
            <div className="video-storyboard-shot-list">
              {data.shots.filter((shot) => shot.scene_id === scene.id).map((shot) => {
                const params = record(shot.generation_params);
                return <div className="video-storyboard-shot" key={shot.id}>
                  <span className="shot-number">{String(shot.display_order + 1).padStart(2, "0")}</span>
                  <div><strong>{shot.description}</strong><small>{time(shot.start_ms)} - {time(shot.end_ms)} · {shot.reuse_strategy.replaceAll("_", " ")}</small></div>
                  <div className="shot-routing"><span>{shot.selected_model || "Editorial"}</span><small>{shot.generation_priority}</small></div>
                  <div className="shot-flags">{tests.has(shot.display_order) ? <Status>Test</Status> : null}{params.vertical_safe === true ? <Status>9:16 safe</Status> : null}<Status>{shot.status.replaceAll("_", " ")}</Status></div>
                </div>;
              })}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function GeneratingNotice({ data }: { data: VideoWorkspaceData }) {
  const pending = data.generations.filter(isPending);
  if (!pending.length) return null;
  return (
    <div className="video-processing-card">
      <span className="video-pulse" /><div><strong>{pending.length} generation{pending.length === 1 ? "" : "s"} in progress</strong><p>Jobs are persisted and recoverable after refresh or deploy.</p></div>
      <form action={refreshPendingVideoGenerations}><input type="hidden" name="project_id" value={data.project.id} /><SubmitButton className="button" pendingLabel="Checking Higgsfield...">Refresh jobs</SubmitButton></form>
    </div>
  );
}

export function LookDevelopmentPanel({ data }: { data: VideoWorkspaceData }) {
  const rows = data.generations.filter((item) => item.operation_type === "look_image");
  if (!["look_dev", "look_review", "test_generation", "test_review", "production", "shot_review", "ready_to_render", "rendering", "complete"].includes(data.project.status) && !rows.length) return null;
  const assets = assetMap(data.assets);
  const planned = rows.filter((item) => item.status === "planned" && !item.approval_id);
  const complete = rows.filter((item) => item.status === "completed" && item.result_asset_id);
  const reserve = planned.reduce((sum, item) => sum + quote(item).reserve, 0);
  const canSpend = data.services.higgsfield.hasCredentials && planned.every((item) => data.services.higgsfield.configuredModels.includes(item.model));
  return (
    <section className="workspace-section" id="look-development">
      <div className="section-head"><div><span className="section-label">Look development</span><h2>Approve the world before motion</h2></div>{rows.length ? <Status>{complete.length}/{rows.length} complete</Status> : null}</div>
      {complete.length ? <div className="video-look-grid">{complete.map((generation) => {
        const asset = generation.result_asset_id ? assets.get(generation.result_asset_id) : null;
        const request = record(generation.request_payload);
        return <article key={generation.id}>{asset?.public_url ? <img src={asset.public_url} alt={typeof request.look_label === "string" ? request.look_label : "Look reference"} /> : <div className="video-media-placeholder">Reference</div>}<div><strong>{typeof request.look_label === "string" ? request.look_label : "Look reference"}</strong><small>{typeof request.look_purpose === "string" ? request.look_purpose : generation.model}</small></div></article>;
      })}</div> : null}
      <GeneratingNotice data={data} />
      {data.project.status === "look_dev" && planned.length ? (
        <form action={approveAndGenerateLookDevelopment} className="video-spend-envelope">
          <div><span className="section-label">Approval envelope</span><h3>Look batch · reserve up to {credits(reserve)}</h3><p>Each item gets one generation. No automatic alternatives or creative retries.</p></div>
          <div className="video-generation-checklist">{planned.map((generation) => { const request = record(generation.request_payload); return <label key={generation.id}><input type="checkbox" name="generation_id" value={generation.id} defaultChecked /><span><strong>{typeof request.look_label === "string" ? request.look_label : "Reference frame"}</strong><small>{generation.model} · max {credits(generation.estimated_credits)}</small></span></label>; })}</div>
          <input type="hidden" name="project_id" value={data.project.id} />
          <SubmitButton pendingLabel="Submitting approved look batch..." disabled={!canSpend}>Approve spend + generate look frames</SubmitButton>
          {!canSpend ? <small>Higgsfield credentials and verified endpoint mapping are required before this button can spend credits.</small> : null}
        </form>
      ) : null}
      {data.project.status === "look_review" && complete.length ? (
        <form action={approveLookReferences} className="video-reference-picker">
          <div><h3>Which frames define the film?</h3><p>Selected references are attached to every generated source shot. Pick the smallest set that clearly establishes materials, palette, lighting and recurring objects.</p></div>
          <div className="video-reference-options">{complete.map((generation, index) => { const asset = generation.result_asset_id ? assets.get(generation.result_asset_id) : null; return asset ? <label key={asset.id}><input type="checkbox" name="asset_id" value={asset.id} defaultChecked={index < 4} /><span>{asset.public_url ? <img src={asset.public_url} alt="Approved visual reference candidate" /> : null}<small>Use as canonical reference</small></span></label> : null; })}</div>
          <input type="hidden" name="project_id" value={data.project.id} />
          <SubmitButton pendingLabel="Binding references to storyboard...">Approve visual language</SubmitButton>
        </form>
      ) : null}
    </section>
  );
}

function BatchForm({ data, operation }: { data: VideoWorkspaceData; operation: "test_video" | "shot_video" }) {
  const planned = data.generations.filter((item) => item.operation_type === operation && item.status === "planned" && !item.approval_id);
  if (!planned.length) return null;
  const shown = operation === "shot_video" ? planned.slice(0, 8) : planned;
  const selectedDefault = operation === "shot_video" ? Math.min(4, shown.length) : shown.length;
  const reserve = shown.slice(0, selectedDefault).reduce((sum, item) => sum + item.estimated_credits, 0);
  const canSpend = data.services.higgsfield.hasCredentials && shown.every((item) => data.services.higgsfield.configuredModels.includes(item.model));
  const action = operation === "test_video" ? approveAndGenerateTestShots : approveAndGenerateNextProductionBatch;
  return (
    <form action={action} className="video-spend-envelope">
      <div><span className="section-label">Approval envelope</span><h3>{operation === "test_video" ? "Representative tests" : "Next production batch"} · about {credits(reserve)} reserved</h3><p>Uncheck anything you want to postpone. Nothing outside this exact selection may be submitted.</p></div>
      <div className="video-generation-checklist">{shown.map((generation, index) => {
        const shot = data.shots.find((item) => item.id === generation.shot_id);
        return <label key={generation.id}><input type="checkbox" name="generation_id" value={generation.id} defaultChecked={index < selectedDefault} /><span><strong>Shot {shot ? String(shot.display_order + 1).padStart(2, "0") : "?"} · {shot?.description || "Video source"}</strong><small>{generation.model} · max {credits(generation.estimated_credits)}</small></span></label>;
      })}</div>
      <input type="hidden" name="project_id" value={data.project.id} /><input type="hidden" name="batch_size" value={selectedDefault} />
      <SubmitButton pendingLabel="Submitting approved generation batch..." disabled={!canSpend}>Approve spend + generate {operation === "test_video" ? "tests" : "batch"}</SubmitButton>
      {!canSpend ? <small>Paid generation stays locked until every selected model has a verified Higgsfield endpoint.</small> : null}
    </form>
  );
}

export function GenerationPanel({ data }: { data: VideoWorkspaceData }) {
  const relevant = ["test_generation", "test_review", "production", "shot_review"].includes(data.project.status) || data.generations.some((item) => item.operation_type !== "look_image");
  if (!relevant) return null;
  return (
    <section className="workspace-section" id="generation">
      <div className="section-head"><div><span className="section-label">Production</span><h2>Spend only inside approved batches</h2></div><Status>{credits(data.project.spent_credits)} spent</Status></div>
      <GeneratingNotice data={data} />
      {data.project.status === "test_generation" ? <BatchForm data={data} operation="test_video" /> : null}
      {data.project.status === "production" ? <BatchForm data={data} operation="shot_video" /> : null}
      <div className="video-approval-ledger">{data.approvals.filter((item) => ["look", "generation_batch"].includes(item.approval_type)).slice(0, 8).map((approval) => <article key={approval.id}><div><strong>{approval.label || approval.approval_type.replaceAll("_", " ")}</strong><small>{new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(approval.approved_at))}</small></div><span>{credits(approval.consumed_credits)} used</span><span>{credits(approval.reserved_credits)} reserved</span><Status>{approval.status}</Status></article>)}</div>
    </section>
  );
}

function GenerationPreview({ generation, asset }: { generation: ExtendedMusicVideoGeneration; asset: MediaAsset | null }) {
  if (!asset?.public_url) return <div className="video-media-placeholder">{generation.status.replaceAll("_", " ")}</div>;
  if (asset.mime_type?.startsWith("image/")) return <img src={asset.public_url} alt="Generated shot candidate" />;
  return <video src={asset.public_url} controls muted playsInline preload="metadata" />;
}

const POSITIVE_SIGNALS = ["Strong visual world", "Camera feels intentional", "Texture feels physical", "Motion fits the music", "Continuity works", "Composition is memorable"];
const NEGATIVE_SIGNALS = ["Too generic", "Too AI-looking", "Wrong palette", "Weak composition", "Motion feels random", "Continuity broke", "Feels like AI fashion", "Does not fit Atlas"];

export function ShotReviewPanel({ data }: { data: VideoWorkspaceData }) {
  const assets = assetMap(data.assets);
  const generationsByShot = new Map<string, ExtendedMusicVideoGeneration[]>();
  data.generations.filter((item) => item.shot_id && item.operation_type !== "look_image").forEach((generation) => {
    const current = generationsByShot.get(generation.shot_id!) ?? [];
    current.push(generation);
    generationsByShot.set(generation.shot_id!, current);
  });
  const visible = data.shots.some((shot) => generationsByShot.has(shot.id) || shot.reuse_strategy !== "unique");
  if (!visible) return null;
  const required = data.shots.filter((shot) => ["unique", "continuation"].includes(shot.reuse_strategy));
  const allLocked = required.length > 0 && required.every((shot) => shot.status === "locked" && shot.selected_asset_id);
  const testIndexes = new Set(Array.isArray(record(data.project.production_plan).test_shot_indexes) ? (record(data.project.production_plan).test_shot_indexes as unknown[]).filter((item): item is number => typeof item === "number") : []);
  const testShots = required.filter((shot) => testIndexes.has(shot.display_order));
  const testsLocked = testShots.length > 0 && testShots.every((shot) => shot.status === "locked" && shot.selected_asset_id);
  return (
    <section className="workspace-section" id="shot-review">
      <div className="section-head"><div><span className="section-label">Director review</span><h2>Keep decisions, not just files</h2></div><Status>{required.filter((shot) => shot.status === "locked").length}/{required.length} sources locked</Status></div>
      <div className="video-review-list">{data.shots.map((shot) => {
        const generations = generationsByShot.get(shot.id) ?? [];
        if (!generations.length && !["reuse_source", "reframe", "hold", "loop"].includes(shot.reuse_strategy)) return null;
        if (!generations.length) return <article className="video-review-shot editorial" key={shot.id}><header><span>{String(shot.display_order + 1).padStart(2, "0")}</span><div><h3>{shot.description}</h3><p>{shot.reuse_strategy.replaceAll("_", " ")} from the previous locked source · no extra generation cost</p></div><Status>Editorial</Status></header></article>;
        return <article className="video-review-shot" key={shot.id}>
          <header><span>{String(shot.display_order + 1).padStart(2, "0")}</span><div><h3>{shot.description}</h3><p>{time(shot.start_ms)} - {time(shot.end_ms)} · {shot.selected_model}</p></div><Status>{shot.status}</Status></header>
          <div className="video-candidate-grid">{generations.filter((generation) => generation.status === "completed" && generation.result_asset_id).map((generation) => {
            const asset = generation.result_asset_id ? assets.get(generation.result_asset_id) ?? null : null;
            const selected = shot.selected_asset_id === generation.result_asset_id;
            return <div className={selected ? "video-candidate selected" : "video-candidate"} key={generation.id}><GenerationPreview generation={generation} asset={asset} /><div className="video-candidate-meta"><span>{generation.model}</span><small>{generation.actual_credits !== null ? `${credits(generation.actual_credits)} charged` : `max ${credits(generation.estimated_credits)}`}</small></div>{selected ? <div className="video-selected-banner">Locked winner</div> : <div className="video-review-actions"><form action={lockShotGeneration}><input type="hidden" name="project_id" value={data.project.id} /><input type="hidden" name="generation_id" value={generation.id} /><select name="signal" defaultValue={POSITIVE_SIGNALS[0]}>{POSITIVE_SIGNALS.map((item) => <option key={item}>{item}</option>)}</select><input name="note" placeholder="Optional note" /><SubmitButton pendingLabel="Locking...">Keep + lock</SubmitButton></form><form action={rejectShotGeneration}><input type="hidden" name="project_id" value={data.project.id} /><input type="hidden" name="generation_id" value={generation.id} /><select name="signal" defaultValue={NEGATIVE_SIGNALS[0]}>{NEGATIVE_SIGNALS.map((item) => <option key={item}>{item}</option>)}</select><input name="note" placeholder="What should change?" /><SubmitButton className="button" pendingLabel="Recording feedback...">Reject</SubmitButton></form></div>}</div>;
          })}</div>
          <details className="video-shot-revision"><summary>Revise this shot or create another option</summary><form action={reviseVideoShot}><input type="hidden" name="project_id" value={data.project.id} /><input type="hidden" name="shot_id" value={shot.id} /><textarea name="instruction" required minLength={3} maxLength={2000} placeholder="Example: keep the same room and materials, but make the camera movement tighter and remove the fashion-editorial feeling." /><SubmitButton pendingLabel="Rewriting shot...">Revise prompt intelligently</SubmitButton></form><form action={requestShotAlternative}><input type="hidden" name="project_id" value={data.project.id} /><input type="hidden" name="shot_id" value={shot.id} /><SubmitButton className="button" pendingLabel="Preparing alternative...">Prepare another generation</SubmitButton><small>This does not spend yet. It creates a new request that still needs a budget approval.</small></form></details>
        </article>;
      })}</div>
      {data.project.status === "test_review" ? <form action={approveTestShots} className="video-section-action"><input type="hidden" name="project_id" value={data.project.id} /><SubmitButton pendingLabel="Opening production..." disabled={!testsLocked}>Approve test language + open production</SubmitButton>{!testsLocked ? <small>Lock a winner for every representative test shot first.</small> : null}</form> : null}
      {["production", "shot_review"].includes(data.project.status) ? <form action={finalizeVideoShotReview} className="video-section-action"><input type="hidden" name="project_id" value={data.project.id} /><SubmitButton pendingLabel="Validating timeline..." disabled={!allLocked}>Finalize shot review</SubmitButton>{!allLocked ? <small>Every paid source sequence must have a locked winner. Editorial reuse shots inherit those sources automatically.</small> : null}</form> : null}
    </section>
  );
}

export function RenderPanel({ data }: { data: VideoWorkspaceData }) {
  if (!["ready_to_render", "rendering", "complete"].includes(data.project.status) && !data.renders.length) return null;
  const assets = assetMap(data.assets);
  const unsafe = data.shots.filter((shot) => !verticalSafe(shot)).length;
  const renderRows = data.renders.map((render) => ({ render, asset: render.media_asset_id ? assets.get(render.media_asset_id) : null }));
  const master = renderRows.find(({ render }) => render.render_type === "master_16_9" && render.status === "completed");
  return (
    <section className="workspace-section" id="render">
      <div className="section-head"><div><span className="section-label">Assembly + delivery</span><h2>One production, multiple finished cuts</h2></div><Status>{data.services.worker.configured ? "Renderer ready" : "Worker setup needed"}</Status></div>
      {renderRows.length ? <div className="video-render-list">{renderRows.map(({ render, asset }) => <article key={render.id}><div><Status>{render.status}</Status><strong>{render.render_type.replaceAll("_", " ")}</strong>{render.error ? <small>{render.error}</small> : null}</div>{asset?.public_url ? <a className="button" href={asset.public_url} target="_blank" rel="noreferrer">Open video</a> : null}</article>)}</div> : null}
      {data.project.status === "ready_to_render" ? <form action={renderVideoOutput} className="video-render-card"><input type="hidden" name="project_id" value={data.project.id} /><input type="hidden" name="render_type" value="master_16_9" /><div><span className="section-label">Master</span><h3>16:9 final music video</h3><p>FFmpeg assembles locked sources to the exact timeline and replaces all generated audio with the original track.</p></div><SubmitButton pendingLabel="Queuing master render..." disabled={!data.services.worker.configured}>Render master</SubmitButton></form> : null}
      {data.project.status === "rendering" ? <div className="video-processing-card"><span className="video-pulse" /><div><strong>Rendering the master</strong><p>The worker will upload the finished file directly into Atlas Media Library and mark this project complete.</p></div><Link className="button" href={`/studio/video/${data.project.id}`}>Refresh</Link></div> : null}
      {data.project.status === "complete" && master ? <div className="video-derived-grid">
        <form action={renderVideoOutput}><input type="hidden" name="project_id" value={data.project.id} /><input type="hidden" name="render_type" value="social_9_16" /><h3>9:16 social cut</h3><p>{unsafe ? `${unsafe} shots are not marked vertical-safe. Atlas will not silently center-crop them.` : "All storyboard shots are marked safe for intelligent vertical reframing."}</p>{unsafe ? <label className="checkbox-field"><input type="checkbox" name="allow_unsafe_vertical" /> I reviewed the risk and approve intelligent crop anyway</label> : null}<SubmitButton pendingLabel="Rendering vertical cut..." disabled={!data.services.worker.configured}>Render 9:16</SubmitButton></form>
        <form action={renderVideoOutput}><input type="hidden" name="project_id" value={data.project.id} /><input type="hidden" name="render_type" value="promo_30" /><h3>30s promo</h3><p>Atlas chooses the strongest energy window from the music map and keeps original master audio.</p><SubmitButton pendingLabel="Rendering promo..." disabled={!data.services.worker.configured}>Render 30s</SubmitButton></form>
        <form action={renderVideoOutput}><input type="hidden" name="project_id" value={data.project.id} /><input type="hidden" name="render_type" value="hook_15" /><h3>15s hook</h3><p>Vertical high-energy cut for Reels/TikTok. Unsafe vertical shots still require explicit approval.</p>{unsafe ? <label className="checkbox-field"><input type="checkbox" name="allow_unsafe_vertical" /> Allow intelligent crop on unsafe shots</label> : null}<SubmitButton pendingLabel="Rendering hook..." disabled={!data.services.worker.configured}>Render 15s hook</SubmitButton></form>
      </div> : null}
    </section>
  );
}
