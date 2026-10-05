import Link from "next/link";
import {
  approveLivingArtworkLoop,
  importLivingArtworkLoop,
  renderLivingArtworkFullTrack,
  renderLivingArtworkSocial,
  repairLivingArtworkLoop,
  retryLivingArtworkNormalization,
} from "@/app/studio/living-artwork-actions";
import {
  approvePreparedCreativeGeneration,
  discardPreparedCreativeGeneration,
  prepareContentCreativeGeneration,
  refreshCreativeGeneration,
} from "@/app/studio/marketing-creative-actions";
import { CompactEvidence, WorkflowStepper } from "@/components/studio/ux-v4-widgets";
import { LivingArtworkCopyButton, LivingArtworkLoopKitPrep } from "@/components/studio/living-artwork-loop-kit-prep";
import { ButtonLink, Disclosure, PageHeader, Status } from "@/components/studio/ui";
import {
  LIVING_ARTWORK_STAGES,
  LIVING_ARTWORK_TARGET,
  type LivingArtworkStage,
} from "@/lib/marketing/living-artwork";
import type { loadLivingArtworkWorkspace } from "@/lib/marketing/living-artwork-workspace";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";

type Workspace = Awaited<ReturnType<typeof loadLivingArtworkWorkspace>>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stageLabel(stage: LivingArtworkStage) {
  if (stage === "make_loop") return "Make loop";
  if (stage === "review") return "Review loop";
  return stage[0].toUpperCase() + stage.slice(1);
}

function jobStatus(status: string | undefined) {
  if (status === "completed") return "Ready";
  if (status === "failed") return "Blocked";
  if (status === "planned" || status === "queued" || status === "running") return "Working";
  return "Needs review";
}

function seamState(asset: Workspace["candidateLoopAsset"]) {
  const metadata = record(asset?.metadata);
  const value = metadata.seam_state;
  return typeof value === "string" ? value : null;
}

function seamCopy(state: string | null) {
  if (state === "ready") return {
    status: "Ready",
    tone: "success" as const,
    title: "The loop closes cleanly.",
    detail: "Ensemblis compared the start and end boundary after normalization. It is ready for your eyes and final approval.",
  };
  if (state === "repair_available") return {
    status: "Repair available",
    tone: "attention" as const,
    title: "The loop is close, but the seam can be smoother.",
    detail: "A short deterministic boundary blend can repair this without spending on another AI generation.",
  };
  if (state === "needs_review") return {
    status: "Needs review",
    tone: "attention" as const,
    title: "The loop is valid, but the seam is visibly uncertain.",
    detail: "Play the boundary a few times. You can approve it if the creative transition is intentional, or replace it with another source loop.",
  };
  if (state === "blocked") return {
    status: "Blocked",
    tone: "danger" as const,
    title: "This seam is too discontinuous to approve.",
    detail: "Replace the short source loop. Ensemblis keeps the original file for lineage, but it will not allow this version to become the reusable approved loop.",
  };
  return {
    status: "Needs review",
    tone: "neutral" as const,
    title: "Review the motion loop.",
    detail: "Check that the ending returns naturally to the start before approving it as your reusable visual source.",
  };
}

function LoopPreview({ src, label }: { src: string; label: string }) {
  return (
    <div className="living-artwork-preview">
      <video src={src} autoPlay muted loop playsInline controls aria-label={label} />
    </div>
  );
}

function SourcePreview({ src, label }: { src: string; label: string }) {
  return (
    <div className="living-artwork-source-frame">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={label} />
    </div>
  );
}

function WorkflowProgress({ current }: { current: LivingArtworkStage }) {
  return (
    <WorkflowStepper
      current={current}
      steps={LIVING_ARTWORK_STAGES.map((stage) => ({
        id: stage,
        label: stageLabel(stage),
      }))}
    />
  );
}

function HiddenContext({ artistId, contentItemId }: { artistId: string; contentItemId: string }) {
  return (
    <>
      <input type="hidden" name="artist_id" value={artistId} />
      <input type="hidden" name="content_item_id" value={contentItemId} />
    </>
  );
}

function SourceStage({ workspace, artistId }: { workspace: Workspace; artistId: string }) {
  if (!workspace.source) {
    return (
      <section className="studio-section living-artwork-stage">
        <span className="section-label">Source</span>
        <h2>Add an approved visual first</h2>
        <p>Living Artwork starts from release artwork or another approved image so the motion extends the artist identity instead of inventing a new one.</p>
        <ButtonLink href={ensemblisArtistHref("/studio/library", artistId)} variant="primary">Open Library</ButtonLink>
      </section>
    );
  }

  return (
    <section className="studio-section living-artwork-stage">
      <div className="living-artwork-stage-grid">
        <SourcePreview src={workspace.source.url} label={workspace.source.label} />
        <div className="living-artwork-stage-copy">
          <span className="section-label">Source</span>
          <Status tone="success">Ready</Status>
          <h2>Use this artwork as the visual anchor</h2>
          <p>{workspace.source.label}. The same composition will anchor both ends of the generated motion loop.</p>
          <p className="living-artwork-helper">No AI generation is needed to prepare the source. Ensemblis keeps this image fixed as the visual identity anchor.</p>
          <Link className="button primary" href="#motion">Choose motion →</Link>
        </div>
      </div>
    </section>
  );
}

function MotionAndKitStage({ workspace, artistId }: { workspace: Workspace; artistId: string }) {
  const contentId = workspace.content.id;
  const source = workspace.source;
  if (!source) return <SourceStage workspace={workspace} artistId={artistId} />;

  return (
    <section className="studio-section living-artwork-stage" id="motion">
      <div className="living-artwork-stage-grid">
        <SourcePreview src={source.url} label={source.label} />
        <div className="living-artwork-stage-copy">
          <span className="section-label">Motion</span>
          <h2>How should the artwork move?</h2>
          <p>Choose the feeling, not a model. Ensemblis keeps the composition recognizable and writes the loop constraints for you.</p>

          <LivingArtworkLoopKitPrep
            artistId={artistId}
            contentItemId={contentId}
            sourceUrl={source.url}
          />

          <CompactEvidence label="What is the Loop Kit?">
            <p>Ensemblis first prepares one portrait source frame from the approved artwork without generative AI. That exact frame becomes both the first and last frame instruction, so the generated motion has a stable visual boundary to return to.</p>
          </CompactEvidence>
        </div>
      </div>
    </section>
  );
}

function GenerationState({ workspace, artistId }: { workspace: Workspace; artistId: string }) {
  const run = workspace.loopGeneration;
  if (!run) return null;
  const output = record(run.output);
  const quote = record(output.quote);
  const stage = typeof output.stage === "string" ? output.stage : "";
  const amount = typeof quote.amount === "number" ? quote.amount : null;
  const currency = typeof quote.currency === "string" ? quote.currency : null;

  if (run.status === "queued" && stage === "prepared") {
    return (
      <div className="living-artwork-generation-card">
        <Status tone="attention">Approval needed</Status>
        <strong>Native generation is prepared</strong>
        <p>{amount !== null && currency ? `Estimated generation: ${amount} ${currency}.` : "The quote is prepared."} Nothing has been submitted yet.</p>
        <div className="actions">
          <form action={approvePreparedCreativeGeneration}>
            <input type="hidden" name="artist_id" value={artistId} />
            <input type="hidden" name="generation_run_id" value={run.id} />
            <button className="button primary" type="submit">Approve generation</button>
          </form>
          <form action={discardPreparedCreativeGeneration}>
            <input type="hidden" name="artist_id" value={artistId} />
            <input type="hidden" name="generation_run_id" value={run.id} />
            <button className="button" type="submit">Discard</button>
          </form>
        </div>
      </div>
    );
  }

  if (run.status === "running") {
    return (
      <div className="living-artwork-generation-card">
        <Status>Working</Status>
        <strong>Generating the short motion loop</strong>
        <p>You can leave this page. The provider result will still be normalized and seam-checked before it can become an approved loop.</p>
        {run.provider_request_id ? (
          <form action={refreshCreativeGeneration}>
            <input type="hidden" name="artist_id" value={artistId} />
            <input type="hidden" name="generation_run_id" value={run.id} />
            <button className="button" type="submit">Check status</button>
          </form>
        ) : null}
      </div>
    );
  }

  if (run.status === "failed") {
    return (
      <div className="living-artwork-generation-card">
        <Status tone="danger">Blocked</Status>
        <strong>Native generation did not complete</strong>
        <p>{run.error || "Use the free Loop Kit or prepare another native generation."}</p>
      </div>
    );
  }

  return (
    <div className="living-artwork-generation-card">
      <Status>{stage.includes("normalization") ? "Checking loop" : "Working"}</Status>
      <strong>Provider motion is safely inside Ensemblis</strong>
      <p>The raw clip cannot become your approved creative until normalization and seam QC finish.</p>
    </div>
  );
}

function MakeLoopStage({ workspace, artistId }: { workspace: Workspace; artistId: string }) {
  const contentId = workspace.content.id;
  const prompt = workspace.content.visual_prompt || "";
  return (
    <section className="studio-section living-artwork-stage">
      <span className="section-label">Make loop</span>
      <h2>Generate only the short motion source</h2>
      <p>Use one short clip. Ensemblis handles duration and export later, so there is no reason to spend AI compute on the full song.</p>

      {prompt ? (
        <div className="living-artwork-loop-kit">
          <div>
            <Status tone="success">Loop Kit ready</Status>
            <strong>{LIVING_ARTWORK_TARGET.aspectRatio} · about {LIVING_ARTWORK_TARGET.recommendedDurationSeconds}s</strong>
            <p>Use this exact portrait frame as both <b>first frame</b> and <b>last frame</b>.</p>
          </div>
          {workspace.source?.url ? (
            <div className="living-artwork-loop-kit-source">
              <SourcePreview src={workspace.source.url} label={workspace.source.label} />
              <a className="button" href={workspace.source.url} target="_blank" rel="noreferrer">Open / save portrait frame</a>
            </div>
          ) : null}
          <label className="field wide">
            <span>Loop-aware prompt</span>
            <textarea rows={9} readOnly value={prompt} />
          </label>
          <LivingArtworkCopyButton text={prompt} />
        </div>
      ) : (
        <p className="ensemblis-notice">Choose a motion direction first to prepare the free Loop Kit.</p>
      )}

      <GenerationState workspace={workspace} artistId={artistId} />

      <Disclosure label="Generate the loop inside Ensemblis instead">
        {workspace.nativeLoopGenerationConfigured ? (
          <form action={prepareContentCreativeGeneration} className="living-artwork-native-form">
            <HiddenContext artistId={artistId} contentItemId={contentId} />
            <input type="hidden" name="creative_intent" value="seamless_loop" />
            <input type="hidden" name="media_kind" value="video" />
            <label className="field">
              <span>Quality</span>
              <select name="quality" defaultValue="balanced">
                <option value="economy">Economy</option>
                <option value="balanced">Balanced · recommended</option>
                <option value="premium">Premium</option>
              </select>
            </label>
            <p>The portrait frame and loop prompt are ready. Ensemblis will show the exact provider quote before submitting any paid generation.</p>
            <button className="button" type="submit">Prepare native generation</button>
          </form>
        ) : (
          <div className="v2-calm-state compact">
            <strong>Native loop generation is not connected.</strong>
            <p>Use the free Loop Kit with any compatible tool, or connect a verified start/end-frame provider.</p>
            <ButtonLink href={ensemblisArtistHref("/studio/connections", artistId)}>Open Connections</ButtonLink>
          </div>
        )}
      </Disclosure>

      {workspace.latestFailedJob ? (
        <div className="living-artwork-generation-card">
          <Status tone="danger">Blocked</Status>
          <strong>
            {workspace.latestFailedJob.job_type === "normalize_loop_video"
              ? "Loop check needs another attempt"
              : workspace.latestFailedJob.job_type === "render_loop_visualizer"
                ? "Full-track render needs another attempt"
                : "Short-form export needs another attempt"}
          </strong>
          <p>{workspace.latestFailedJob.error || "The media worker could not complete this step. Your approved sources are still safe."}</p>
          {workspace.latestFailedJob.job_type === "normalize_loop_video" ? (
            <form action={retryLivingArtworkNormalization}>
              <HiddenContext artistId={artistId} contentItemId={contentId} />
              <input type="hidden" name="media_job_id" value={workspace.latestFailedJob.id} />
              <button className="button primary" type="submit">Retry loop check</button>
            </form>
          ) : null}
        </div>
      ) : null}

      {workspace.activeJob ? (
        <div className="living-artwork-generation-card">
          <Status>{jobStatus(workspace.activeJob.status)}</Status>
          <strong>{workspace.activeJob.job_type === "normalize_loop_video" ? "Checking the loop seam" : "Rendering your export"}</strong>
          <p>This work is durable. You can leave and return without losing progress.</p>
        </div>
      ) : null}

      <form action={importLivingArtworkLoop} className="living-artwork-import-form">
        <HiddenContext artistId={artistId} contentItemId={contentId} />
        <label className="field wide">
          <span>Bring back the short loop</span>
          <input type="file" name="loop_file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v" required />
          <small>Upload the short generated clip, not the full song video. Ensemblis will normalize it and check the end → start seam.</small>
        </label>
        <button className="button primary" type="submit">Import and check loop</button>
      </form>
    </section>
  );
}

function ReviewStage({ workspace, artistId }: { workspace: Workspace; artistId: string }) {
  const asset = workspace.candidateLoopAsset;
  if (!asset?.public_url) return <MakeLoopStage workspace={workspace} artistId={artistId} />;
  const state = seamState(asset);
  const qc = seamCopy(state);
  const metadata = record(asset.metadata);
  const repaired = metadata.repaired === true;

  return (
    <section className="studio-section living-artwork-stage">
      <div className="living-artwork-stage-grid">
        <LoopPreview src={asset.public_url} label="Living Artwork loop review" />
        <div className="living-artwork-stage-copy">
          <span className="section-label">Review loop</span>
          <Status tone={qc.tone}>{qc.status}</Status>
          <h2>{qc.title}</h2>
          <p>{qc.detail}</p>
          {repaired ? <p className="living-artwork-helper">This version includes a small deterministic seam repair. No additional AI generation was used.</p> : null}

          <p className="living-artwork-helper">The preview loops continuously so the exact end → start boundary repeats while you listen with your eyes.</p>

          {state === "blocked" ? (
            <form action={importLivingArtworkLoop} className="living-artwork-import-form">
              <HiddenContext artistId={artistId} contentItemId={workspace.content.id} />
              <label className="field wide">
                <span>Replace the short loop</span>
                <input type="file" name="loop_file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v" required />
              </label>
              <button className="button primary" type="submit">Import replacement</button>
            </form>
          ) : (
            <div className="actions">
              {state === "repair_available" ? (
                <form action={repairLivingArtworkLoop}>
                  <HiddenContext artistId={artistId} contentItemId={workspace.content.id} />
                  <input type="hidden" name="media_asset_id" value={asset.id} />
                  <button className="button primary" type="submit">Auto repair seam</button>
                </form>
              ) : (
                <form action={approveLivingArtworkLoop}>
                  <HiddenContext artistId={artistId} contentItemId={workspace.content.id} />
                  <input type="hidden" name="media_asset_id" value={asset.id} />
                  <button className="button primary" type="submit">Approve loop</button>
                </form>
              )}
              {state === "repair_available" ? (
                <form action={approveLivingArtworkLoop}>
                  <HiddenContext artistId={artistId} contentItemId={workspace.content.id} />
                  <input type="hidden" name="media_asset_id" value={asset.id} />
                  <button className="button" type="submit">Approve as-is</button>
                </form>
              ) : null}
            </div>
          )}

          <CompactEvidence label="Technical loop check">
            <p>Ensemblis compares the normalized start/end boundary and luminance continuity. The raw provider/import remains in Media Library history even when you approve a repaired version.</p>
            <pre>{JSON.stringify({
              seamState: metadata.seam_state ?? "unknown",
              endpointSimilarity: metadata.seam_similarity ?? null,
              boundaryWindowSimilarity: metadata.boundary_window_similarity ?? null,
              colorDelta: metadata.color_delta ?? null,
              freezeSuspected: metadata.freeze_suspected === true,
              repaired: metadata.repaired === true,
              repairMs: metadata.repair_ms ?? 0,
            }, null, 2)}</pre>
          </CompactEvidence>
        </div>
      </div>
    </section>
  );
}

function ExportStage({ workspace, artistId }: { workspace: Workspace; artistId: string }) {
  const loop = workspace.approvedLoopAsset;
  if (!loop?.public_url) return <ReviewStage workspace={workspace} artistId={artistId} />;
  const rendering = workspace.jobs.find((job) =>
    job.job_type === "render_loop_visualizer" && ["planned", "queued", "running"].includes(job.status),
  );

  return (
    <section className="studio-section living-artwork-stage">
      <span className="section-label">Export</span>
      <div className="living-artwork-stage-grid">
        <LoopPreview src={loop.public_url} label="Approved Living Artwork loop" />
        <div className="living-artwork-stage-copy">
          <Status tone="success">Loop approved</Status>
          <h2>Reuse this motion instead of generating again</h2>
          <p>This short loop is now the reusable visual source. Duration changes are deterministic and do not require another AI generation.</p>

          {workspace.fullTrackAsset?.public_url ? (
            <div className="living-artwork-export-card">
              <Status tone="success">Ready</Status>
              <strong>Full song · Vertical</strong>
              <p>The approved loop repeats for the exact track duration with canonical track audio.</p>
              <a className="button primary" href={workspace.fullTrackAsset.public_url} target="_blank" rel="noreferrer">Open full-track video</a>
            </div>
          ) : rendering ? (
            <div className="living-artwork-export-card">
              <Status>Working</Status>
              <strong>Full song · Vertical</strong>
              <p>The media worker is repeating the approved loop and muxing the canonical track audio. No mastering or dynamics processing is applied.</p>
            </div>
          ) : (
            <div className="living-artwork-export-card">
              <strong>Full song · Vertical</strong>
              <p>1080×1920 full-track visualizer. The music is preserved as the source truth; only MP4 delivery encoding is applied.</p>
              <form action={renderLivingArtworkFullTrack}>
                <HiddenContext artistId={artistId} contentItemId={workspace.content.id} />
                <button className="button primary" type="submit">Render full-track video</button>
              </form>
            </div>
          )}

          <div className="living-artwork-export-card">
            {workspace.socialAsset?.public_url ? <Status tone="success">Ready</Status> : null}
            <strong>Reel / Story / Short</strong>
            <p>The same approved loop uses the selected musical Moment for a short vertical export. No new motion is generated.</p>
            {workspace.socialAsset?.public_url ? (
              <a className="button primary" href={workspace.socialAsset.public_url} target="_blank" rel="noreferrer">Open short-form video</a>
            ) : workspace.jobs.some((job) =>
              job.job_type === "finish_social_video"
              && record(job.request_payload).living_artwork_export === "social"
              && ["planned", "queued", "running"].includes(job.status)
            ) ? (
              <Status>Working</Status>
            ) : (
              <form action={renderLivingArtworkSocial}>
                <HiddenContext artistId={artistId} contentItemId={workspace.content.id} />
                <button className="button" type="submit">Render short-form video</button>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function LivingArtworkWorkflow({
  artistId,
  workspace,
}: {
  artistId: string;
  workspace: Workspace;
}) {
  const releaseTitle = workspace.context.release.title;
  const trackTitle = workspace.track?.title;
  const current = workspace.stage;

  return (
    <div className="studio-v2-page living-artwork-page">
      <PageHeader
        eyebrow="Create"
        title="Living Artwork"
        description={`Turn ${releaseTitle} artwork into one reusable seamless motion loop. Generate motion once; Ensemblis handles the rest deterministically.`}
        actions={
          <ButtonLink href={ensemblisArtistHref(workspace.content.release_id ? `/studio/releases/${workspace.content.release_id}` : "/studio/create", artistId)}>
            Back
          </ButtonLink>
        }
      />

      <div className="living-artwork-context-strip">
        <div>
          <span className="section-label">Creating for</span>
          <strong>{releaseTitle}</strong>
          <small>{trackTitle || "Release creative"} · {workspace.content.title}</small>
        </div>
        <Status>{stageLabel(current)}</Status>
      </div>

      <WorkflowProgress current={current} />

      {current === "source" ? <SourceStage workspace={workspace} artistId={artistId} /> : null}
      {current === "motion" ? <MotionAndKitStage workspace={workspace} artistId={artistId} /> : null}
      {current === "make_loop" ? <MakeLoopStage workspace={workspace} artistId={artistId} /> : null}
      {current === "review" ? <ReviewStage workspace={workspace} artistId={artistId} /> : null}
      {current === "export" ? <ExportStage workspace={workspace} artistId={artistId} /> : null}

      <Disclosure label="How this saves generation cost">
        <p>Living Artwork deliberately separates creative generation from video duration. The only generative step is the short reusable loop. Full-track and social variants repeat, resize, trim and mux that approved source with deterministic media processing.</p>
      </Disclosure>
    </div>
  );
}
