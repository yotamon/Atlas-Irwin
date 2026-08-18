/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { renderVideoOutput } from "@/app/studio/video-pipeline-actions";
import {
  generateVideoThumbnailCandidates,
  selectVideoThumbnail,
} from "@/app/studio/video-thumbnail-actions";
import { SubmitButton } from "@/components/studio/submit-button";
import { Status } from "@/components/studio/ui";
import type { Json, MediaAsset, MusicVideoRender } from "@/types/database";
import type { ExtendedMusicVideoShot } from "@/types/video-database";
import type { VideoWorkspaceData } from "./workspace-types";

function record(value: Json | unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function verticalSafe(shot: ExtendedMusicVideoShot) {
  return record(shot.generation_params).vertical_safe === true;
}

function renderLabel(render: MusicVideoRender, primaryAspect: string) {
  switch (render.render_type) {
    case "master_16_9": return `Master ${primaryAspect}`;
    case "social_9_16": return "9:16 social cut";
    case "promo_30": return `30s promo ${primaryAspect}`;
    case "hook_15": return "15s vertical hook";
    default: return render.render_type.replaceAll("_", " ");
  }
}

function projectThumbnail(asset: MediaAsset, projectId: string) {
  return asset.asset_type === "thumbnail" && record(asset.metadata).project_id === projectId;
}

function selectedThumbnail(asset: MediaAsset) {
  return record(asset.metadata).selected_thumbnail === true;
}

function thumbnailTimestamp(asset: MediaAsset) {
  const value = record(asset.metadata).timestamp_ms;
  if (typeof value !== "number") return "Final master still";
  const total = Math.max(0, Math.round(value / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function DeliveryPanel({ data }: { data: VideoWorkspaceData }) {
  if (!["ready_to_render", "rendering", "complete"].includes(data.project.status) && !data.renders.length) return null;

  const assetsById = new Map(data.assets.map((asset) => [asset.id, asset]));
  const renderRows = data.renders.map((render) => ({
    render,
    asset: render.media_asset_id ? assetsById.get(render.media_asset_id) ?? null : null,
  }));
  const master = renderRows.find(({ render }) => render.render_type === "master_16_9" && render.status === "completed");
  const primaryIsVertical = data.project.primary_aspect_ratio === "9:16";
  const unsafe = primaryIsVertical ? 0 : data.shots.filter((shot) => !verticalSafe(shot)).length;

  const thumbnails = data.assets
    .filter((asset) => projectThumbnail(asset, data.project.id))
    .sort((a, b) => {
      const aTime = record(a.metadata).timestamp_ms;
      const bTime = record(b.metadata).timestamp_ms;
      return (typeof aTime === "number" ? aTime : 0) - (typeof bTime === "number" ? bTime : 0);
    });
  const thumbnailJobs = data.workerJobs.filter((job) => job.job_type === "extract_frame");
  const thumbnailPending = thumbnailJobs.filter((job) => ["planned", "queued", "running"].includes(job.status)).length;
  const thumbnailFailed = thumbnailJobs.filter((job) => job.status === "failed").length;

  return (
    <section className="workspace-section" id="render">
      <div className="section-head">
        <div><span className="section-label">Assembly + delivery</span><h2>One production, finished for every surface</h2></div>
        <Status>{data.services.worker.configured ? "Renderer ready" : "Worker setup needed"}</Status>
      </div>

      {renderRows.length ? (
        <div className="video-render-list">
          {renderRows.map(({ render, asset }) => (
            <article key={render.id}>
              <div>
                <Status>{render.status}</Status>
                <strong>{renderLabel(render, data.project.primary_aspect_ratio)}</strong>
                {render.error ? <small>{render.error}</small> : null}
              </div>
              {asset?.public_url ? <a className="button" href={asset.public_url} target="_blank" rel="noreferrer">Open video</a> : null}
            </article>
          ))}
        </div>
      ) : null}

      {data.project.status === "ready_to_render" ? (
        <form action={renderVideoOutput} className="video-render-card">
          <input type="hidden" name="project_id" value={data.project.id} />
          <input type="hidden" name="render_type" value="master_16_9" />
          <div>
            <span className="section-label">Master</span>
            <h3>{data.project.primary_aspect_ratio} final music video</h3>
            <p>FFmpeg assembles every locked source to the approved timeline and replaces generated audio with the original Atlas track.</p>
          </div>
          <SubmitButton pendingLabel="Queuing master render..." disabled={!data.services.worker.configured}>Render master</SubmitButton>
        </form>
      ) : null}

      {data.project.status === "rendering" ? (
        <div className="video-processing-card">
          <span className="video-pulse" />
          <div><strong>Rendering the master</strong><p>The job is durable. The worker uploads the finished video directly into Atlas Media Library.</p></div>
          <Link className="button" href={`/studio/video/${data.project.id}`}>Refresh</Link>
        </div>
      ) : null}

      {data.project.status === "complete" && master ? (
        <>
          <div className="video-derived-grid">
            <form action={renderVideoOutput}>
              <input type="hidden" name="project_id" value={data.project.id} />
              <input type="hidden" name="render_type" value="social_9_16" />
              <h3>9:16 social cut</h3>
              <p>{unsafe ? `${unsafe} shots need explicit crop approval. Atlas will not silently center-crop them.` : primaryIsVertical ? "The primary production is already vertical, so no crop safety override is needed." : "All storyboard shots are marked safe for intelligent vertical reframing."}</p>
              {unsafe ? <label className="checkbox-field"><input type="checkbox" name="allow_unsafe_vertical" /> I reviewed the risk and approve intelligent crop anyway</label> : null}
              <SubmitButton pendingLabel="Rendering vertical cut..." disabled={!data.services.worker.configured}>Render 9:16</SubmitButton>
            </form>
            <form action={renderVideoOutput}>
              <input type="hidden" name="project_id" value={data.project.id} />
              <input type="hidden" name="render_type" value="promo_30" />
              <h3>30s promo</h3>
              <p>Atlas chooses the strongest energy window and keeps the master&apos;s {data.project.primary_aspect_ratio} format and original audio.</p>
              <SubmitButton pendingLabel="Rendering promo..." disabled={!data.services.worker.configured}>Render 30s</SubmitButton>
            </form>
            <form action={renderVideoOutput}>
              <input type="hidden" name="project_id" value={data.project.id} />
              <input type="hidden" name="render_type" value="hook_15" />
              <h3>15s hook</h3>
              <p>High-energy 9:16 cut for Reels/TikTok, using subject-aware framing rather than a blind center crop.</p>
              {unsafe ? <label className="checkbox-field"><input type="checkbox" name="allow_unsafe_vertical" /> Allow intelligent crop on unsafe shots</label> : null}
              <SubmitButton pendingLabel="Rendering hook..." disabled={!data.services.worker.configured}>Render 15s hook</SubmitButton>
            </form>
          </div>

          <div className="video-render-card">
            <div>
              <span className="section-label">Thumbnail studio</span>
              <h3>Still candidates from the final master</h3>
              <p>Atlas extracts high-quality frames around musical peaks and strong sections. This uses the Media Worker only, with no Higgsfield spend.</p>
            </div>
            <form action={generateVideoThumbnailCandidates}>
              <input type="hidden" name="project_id" value={data.project.id} />
              <SubmitButton pendingLabel="Extracting thumbnail candidates..." disabled={!data.services.worker.configured || thumbnailPending > 0}>
                {thumbnails.length ? "Refresh / retry candidates" : "Generate thumbnail candidates"}
              </SubmitButton>
            </form>
          </div>

          {thumbnailPending ? (
            <div className="video-processing-card">
              <span className="video-pulse" />
              <div><strong>{thumbnailPending} thumbnail candidate{thumbnailPending === 1 ? "" : "s"} processing</strong><p>You can leave this page. Extraction jobs are persisted just like renders.</p></div>
              <Link className="button" href={`/studio/video/${data.project.id}`}>Refresh</Link>
            </div>
          ) : null}
          {thumbnailFailed ? <p className="video-inline-note">{thumbnailFailed} thumbnail extraction{thumbnailFailed === 1 ? " needs" : "s need"} attention. Use Refresh / retry candidates to resubmit failed worker jobs.</p> : null}

          {thumbnails.length ? (
            <div className="video-look-grid">
              {thumbnails.map((asset) => {
                const selected = selectedThumbnail(asset);
                return (
                  <article key={asset.id} className={selected ? "selected" : undefined}>
                    {asset.public_url ? <img src={asset.public_url} alt={`Thumbnail candidate at ${thumbnailTimestamp(asset)}`} /> : <div className="video-media-placeholder">Still</div>}
                    <div><strong>{thumbnailTimestamp(asset)}</strong><small>{selected ? "Selected primary thumbnail" : "Final master still"}</small></div>
                    {selected ? <div className="video-selected-banner">Primary thumbnail</div> : (
                      <form action={selectVideoThumbnail}>
                        <input type="hidden" name="project_id" value={data.project.id} />
                        <input type="hidden" name="asset_id" value={asset.id} />
                        <SubmitButton pendingLabel="Selecting thumbnail..." className="button">Use thumbnail</SubmitButton>
                      </form>
                    )}
                  </article>
                );
              })}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
