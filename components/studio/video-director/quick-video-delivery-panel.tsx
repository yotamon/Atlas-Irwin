import Link from "next/link";
import { retryQuickVideoSocialPack } from "@/app/studio/quick-video-social-actions";
import { renderVideoOutput } from "@/app/studio/video-pipeline-actions";
import { SubmitButton } from "@/components/studio/submit-button";
import { Status } from "@/components/studio/ui";
import type { Json, MusicVideoRender } from "@/types/database";
import type { ExtendedMusicVideoShot } from "@/types/video-database";
import type { VideoWorkspaceData } from "./workspace-types";

const DERIVED = [
  {
    type: "hook_15",
    title: "Hero hook",
    detail: "Vertical short built around the strongest approved Moment for Reels and TikTok.",
    vertical: true,
  },
  {
    type: "promo_30",
    title: "Promo cut",
    detail: "A distinct high-value Moment when available, keeping the master format for a second creative angle.",
    vertical: false,
  },
  {
    type: "social_9_16",
    title: "Full vertical cut",
    detail: "The approved master edit reframed to 9:16 using shot-level subject focus and crop safety.",
    vertical: true,
  },
] as const;

type DerivedType = (typeof DERIVED)[number]["type"];

function record(value: Json | unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function verticalSafe(shot: ExtendedMusicVideoShot) {
  return record(shot.generation_params).vertical_safe === true;
}

function latestRender(renders: MusicVideoRender[], type: MusicVideoRender["render_type"]) {
  return renders
    .filter((render) => render.render_type === type)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null;
}

function renderState(render: MusicVideoRender | null, waitingForAutoQueue: boolean) {
  if (!render) return waitingForAutoQueue ? "Preparing" : "Not prepared";
  if (render.status === "completed") return "Ready";
  if (render.status === "failed") return "Needs retry";
  return "Preparing";
}

function momentNote(render: MusicVideoRender | null) {
  if (!render) return null;
  const spec = record(render.render_spec);
  if (spec.music_window_source !== "approved_moment") return null;
  const label = typeof spec.music_moment_label === "string" ? spec.music_moment_label : null;
  return label ? `Cut from approved Moment: ${label}` : "Cut from the strongest approved Moment.";
}

function DerivedCard({
  data,
  type,
  title,
  detail,
  vertical,
  unsafe,
  waitingForAutoQueue,
}: {
  data: VideoWorkspaceData;
  type: DerivedType;
  title: string;
  detail: string;
  vertical: boolean;
  unsafe: number;
  waitingForAutoQueue: boolean;
}) {
  const render = latestRender(data.renders, type);
  const asset = render?.media_asset_id
    ? data.assets.find((candidate) => candidate.id === render.media_asset_id) ?? null
    : null;
  const ready = render?.status === "completed";
  const busy = Boolean(render && ["planned", "queued"].includes(render.status));
  const needsCropReview = vertical && unsafe > 0 && !ready && !busy;
  const note = momentNote(render);

  return (
    <article className="video-render-card">
      <div>
        <span className="section-label">{type === "hook_15" ? "Primary social" : "Derived output"}</span>
        <h3>{title}</h3>
        <p>{detail}</p>
        {note ? <small>{note}</small> : null}
        {render?.error ? <small>{render.error}</small> : null}
      </div>
      <div className="video-section-action">
        <Status>{renderState(render, waitingForAutoQueue)}</Status>
        {asset?.public_url ? (
          <a className="button" href={asset.public_url} target="_blank" rel="noreferrer">Open video</a>
        ) : null}
        {needsCropReview ? (
          <form action={renderVideoOutput} className="video-section-action">
            <input type="hidden" name="project_id" value={data.project.id} />
            <input type="hidden" name="render_type" value={type} />
            <label className="checkbox-field">
              <input type="checkbox" name="allow_unsafe_vertical" required />
              I reviewed the crop risk and approve intelligent reframing for {unsafe} non-safe shot{unsafe === 1 ? "" : "s"}.
            </label>
            <SubmitButton pendingLabel="Preparing vertical output...">Approve crop and prepare</SubmitButton>
          </form>
        ) : null}
        {render?.status === "failed" && !needsCropReview ? (
          <form action={renderVideoOutput}>
            <input type="hidden" name="project_id" value={data.project.id} />
            <input type="hidden" name="render_type" value={type} />
            <SubmitButton pendingLabel="Retrying output...">Retry</SubmitButton>
          </form>
        ) : null}
      </div>
    </article>
  );
}

export function QuickVideoDeliveryPanel({ data }: { data: VideoWorkspaceData }) {
  if (!["ready_to_render", "rendering", "complete"].includes(data.project.status) && !data.renders.length) return null;

  const master = latestRender(data.renders, "master_16_9");
  const masterAsset = master?.media_asset_id
    ? data.assets.find((asset) => asset.id === master.media_asset_id) ?? null
    : null;
  const primaryIsVertical = data.project.primary_aspect_ratio === "9:16";
  const unsafe = primaryIsVertical ? 0 : data.shots.filter((shot) => !verticalSafe(shot)).length;
  const completedDerived = DERIVED.filter(({ type }) => latestRender(data.renders, type)?.status === "completed").length;
  const pendingDerived = DERIVED.filter(({ type }) => {
    const render = latestRender(data.renders, type);
    return Boolean(render && ["planned", "queued"].includes(render.status));
  }).length;
  const waitingForAutoQueue = data.project.status === "complete" && completedDerived + pendingDerived < DERIVED.length;

  return (
    <section className="workspace-section" id="quick-delivery">
      <div className="section-head">
        <div>
          <span className="section-label">Master + socials</span>
          <h2>Approve one film. Ensemblis finishes the delivery pack.</h2>
        </div>
        <Status>{data.project.status === "complete" ? `${completedDerived}/${DERIVED.length} socials ready` : "Master first"}</Status>
      </div>
      <p className="section-copy">
        Social outputs reuse the approved edit, locked source shots and original track. They do not submit new paid AI generations.
      </p>

      {data.project.status === "ready_to_render" ? (
        <form action={renderVideoOutput} className="video-render-card">
          <input type="hidden" name="project_id" value={data.project.id} />
          <input type="hidden" name="render_type" value="master_16_9" />
          <div>
            <span className="section-label">Final master</span>
            <h3>{data.project.primary_aspect_ratio} approved edit</h3>
            <p>Assemble the locked production with the original track. When this completes, the social pack starts automatically.</p>
          </div>
          <SubmitButton pendingLabel="Queuing master render..." disabled={!data.services.worker.configured}>Render final master</SubmitButton>
        </form>
      ) : null}

      {data.project.status === "rendering" ? (
        <div className="video-processing-card">
          <span className="video-pulse" />
          <div>
            <strong>Rendering the final master</strong>
            <p>The social pack will start automatically after the master is safely registered.</p>
          </div>
          <Link className="button" href={`/studio/video/${data.project.id}`}>Refresh</Link>
        </div>
      ) : null}

      {data.project.status === "complete" ? (
        <>
          <article className="video-render-card">
            <div>
              <span className="section-label">Master</span>
              <h3>Final music video</h3>
              <p>The source of truth for the delivery pack.</p>
            </div>
            <div className="video-section-action">
              <Status>{master?.status === "completed" ? "Ready" : "Preparing"}</Status>
              {masterAsset?.public_url ? <a className="button" href={masterAsset.public_url} target="_blank" rel="noreferrer">Open master</a> : null}
            </div>
          </article>

          <div className="video-derived-grid">
            {DERIVED.map((output) => (
              <DerivedCard
                key={output.type}
                data={data}
                {...output}
                unsafe={unsafe}
                waitingForAutoQueue={waitingForAutoQueue}
              />
            ))}
          </div>

          {waitingForAutoQueue ? (
            <div className="video-render-card">
              <div>
                <span className="section-label">Delivery recovery</span>
                <h3>Missing output?</h3>
                <p>Re-run the zero-generation-spend delivery orchestrator. Existing or completed renders are reused, never duplicated.</p>
              </div>
              <form action={retryQuickVideoSocialPack}>
                <input type="hidden" name="project_id" value={data.project.id} />
                <SubmitButton pendingLabel="Checking social pack..." disabled={!data.services.worker.configured}>Prepare missing outputs</SubmitButton>
              </form>
            </div>
          ) : null}

          {unsafe ? (
            <p className="video-inline-note">
              {unsafe} shot{unsafe === 1 ? " is" : "s are"} not marked vertical-safe. Ensemblis will prepare safe outputs automatically and ask before forcing intelligent crop on the rest.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
