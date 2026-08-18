/* eslint-disable @next/next/no-img-element */
import {
  approveAndGenerateLookDevelopment,
  approveLookReferences,
  refreshPendingVideoGenerations,
} from "@/app/studio/video-pipeline-actions";
import {
  rejectLookReference,
  reviseLookReference,
} from "@/app/studio/video-look-actions";
import { SubmitButton } from "@/components/studio/submit-button";
import { Status } from "@/components/studio/ui";
import type { Json, MediaAsset } from "@/types/database";
import type { ExtendedMusicVideoGeneration } from "@/types/video-database";
import type { VideoWorkspaceData } from "./workspace-types";

function record(value: Json | unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function credits(value: number) {
  return `${Number(value || 0).toFixed(2)} cr`;
}

function isPending(generation: ExtendedMusicVideoGeneration) {
  return ["approved", "submitted", "queued", "in_progress"].includes(generation.status);
}

function assetMap(assets: MediaAsset[]) {
  return new Map(assets.map((asset) => [asset.id, asset]));
}

function rejected(asset: MediaAsset | null | undefined) {
  return asset ? record(asset.metadata).look_rejected === true : false;
}

function lookLabel(generation: ExtendedMusicVideoGeneration) {
  const request = record(generation.request_payload);
  return typeof request.look_label === "string" ? request.look_label : "Look reference";
}

function lookPurpose(generation: ExtendedMusicVideoGeneration) {
  const request = record(generation.request_payload);
  return typeof request.look_purpose === "string" ? request.look_purpose : generation.model;
}

export function LookDevelopmentPanel({ data }: { data: VideoWorkspaceData }) {
  const rows = data.generations.filter((item) => item.operation_type === "look_image");
  if (!["look_dev", "look_review", "test_generation", "test_review", "production", "shot_review", "ready_to_render", "rendering", "complete"].includes(data.project.status) && !rows.length) return null;

  const assets = assetMap(data.assets);
  const planned = rows.filter((item) => item.status === "planned" && !item.approval_id);
  const pending = rows.filter(isPending);
  const complete = rows.filter((item) => item.status === "completed" && item.result_asset_id);
  const activeComplete = complete.filter((generation) => !rejected(generation.result_asset_id ? assets.get(generation.result_asset_id) : null));
  const rejectedComplete = complete.filter((generation) => rejected(generation.result_asset_id ? assets.get(generation.result_asset_id) : null));
  const reserve = planned.reduce((sum, item) => sum + Number(item.estimated_credits), 0);
  const canSpend = data.services.higgsfield.hasCredentials && planned.length > 0 && planned.every((item) => data.services.higgsfield.configuredModels.includes(item.model));

  return (
    <section className="workspace-section" id="look-development">
      <div className="section-head">
        <div><span className="section-label">Look development</span><h2>Approve the world before motion</h2></div>
        {rows.length ? <Status>{activeComplete.length} usable · {rejectedComplete.length} rejected</Status> : null}
      </div>

      {complete.length ? (
        <div className="video-look-grid">
          {complete.map((generation) => {
            const asset = generation.result_asset_id ? assets.get(generation.result_asset_id) : null;
            const isRejected = rejected(asset);
            const reason = asset ? record(asset.metadata).look_rejection_reason : null;
            return (
              <article key={generation.id} className={isRejected ? "rejected" : undefined}>
                {asset?.public_url ? <img src={asset.public_url} alt={lookLabel(generation)} /> : <div className="video-media-placeholder">Reference</div>}
                <div>
                  <strong>{lookLabel(generation)}</strong>
                  <small>{isRejected ? `Rejected${typeof reason === "string" ? ` · ${reason}` : ""}` : lookPurpose(generation)}</small>
                </div>
                {data.project.status === "look_review" ? (
                  <div className="video-look-review-actions">
                    {!isRejected ? (
                      <form action={rejectLookReference}>
                        <input type="hidden" name="project_id" value={data.project.id} />
                        <input type="hidden" name="generation_id" value={generation.id} />
                        <input name="reason" maxLength={1000} placeholder="Why reject? Optional" aria-label={`Reason for rejecting ${lookLabel(generation)}`} />
                        <SubmitButton className="button" pendingLabel="Rejecting frame...">Reject</SubmitButton>
                      </form>
                    ) : null}
                    <form action={reviseLookReference} className="video-look-revision-form">
                      <input type="hidden" name="project_id" value={data.project.id} />
                      <input type="hidden" name="generation_id" value={generation.id} />
                      <input required minLength={3} maxLength={1500} name="instruction" placeholder="Change this frame: warmer brass, remove faces, tighter crop..." aria-label={`Revision instruction for ${lookLabel(generation)}`} />
                      <SubmitButton className="button" pendingLabel="Preparing revised frame...">Revise frame</SubmitButton>
                    </form>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}

      {pending.length ? (
        <div className="video-processing-card">
          <span className="video-pulse" />
          <div><strong>{pending.length} look generation{pending.length === 1 ? "" : "s"} in progress</strong><p>Jobs are persisted. Refresh checks Higgsfield without creating new generations.</p></div>
          <form action={refreshPendingVideoGenerations}>
            <input type="hidden" name="project_id" value={data.project.id} />
            <SubmitButton className="button" pendingLabel="Checking Higgsfield...">Refresh jobs</SubmitButton>
          </form>
        </div>
      ) : null}

      {data.project.status === "look_dev" && planned.length ? (
        <form action={approveAndGenerateLookDevelopment} className="video-spend-envelope">
          <div>
            <span className="section-label">Approval envelope</span>
            <h3>Look batch · reserve up to {credits(reserve)}</h3>
            <p>Each checked item gets exactly one generation. Revised frames are new paid requests and never inherit an old approval automatically.</p>
          </div>
          <div className="video-generation-checklist">
            {planned.map((generation) => (
              <label key={generation.id}>
                <input type="checkbox" name="generation_id" value={generation.id} defaultChecked />
                <span><strong>{lookLabel(generation)}</strong><small>{generation.model} · max {credits(generation.estimated_credits)}</small></span>
              </label>
            ))}
          </div>
          <input type="hidden" name="project_id" value={data.project.id} />
          <SubmitButton pendingLabel="Submitting approved look batch..." disabled={!canSpend}>Approve spend + generate look frames</SubmitButton>
          {!canSpend ? <small>Higgsfield credentials and verified endpoint mapping are required before this button can spend credits.</small> : null}
        </form>
      ) : null}

      {data.project.status === "look_review" ? (
        activeComplete.length ? (
          <form action={approveLookReferences} className="video-reference-picker">
            <div>
              <h3>Which frames define the film?</h3>
              <p>Rejected frames are excluded automatically. Select the smallest set that clearly establishes materials, palette, lighting and recurring objects.</p>
            </div>
            <div className="video-reference-options">
              {activeComplete.map((generation, index) => {
                const asset = generation.result_asset_id ? assets.get(generation.result_asset_id) : null;
                return asset ? (
                  <label key={asset.id}>
                    <input type="checkbox" name="asset_id" value={asset.id} defaultChecked={index < 4} />
                    <span>{asset.public_url ? <img src={asset.public_url} alt="Approved visual reference candidate" /> : null}<small>Use as canonical reference</small></span>
                  </label>
                ) : null;
              })}
            </div>
            <input type="hidden" name="project_id" value={data.project.id} />
            <SubmitButton pendingLabel="Binding references to storyboard...">Approve visual language</SubmitButton>
          </form>
        ) : (
          <div className="video-inline-note">All completed look frames are rejected. Revise at least one frame before moving to test generation.</div>
        )
      ) : null}
    </section>
  );
}
