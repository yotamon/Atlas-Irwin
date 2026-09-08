"use client";

/* eslint-disable @next/next/no-img-element */
import { useTransition } from "react";
import {
  approveAndGenerateVideoVariant,
  prepareVideoShotVariant,
  refreshVideoShotVariants,
  rejectVideoShotVariant,
  selectVideoShotVariant,
} from "@/app/studio/video-editor-actions";
import type { ExtendedMusicVideoGeneration, ExtendedMusicVideoShot } from "@/types/video-database";
import type { VideoWorkspaceData } from "../workspace-types";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function assetForGeneration(data: VideoWorkspaceData, generation: ExtendedMusicVideoGeneration) {
  return generation.result_asset_id ? data.assets.find((asset) => asset.id === generation.result_asset_id) ?? null : null;
}

function isVideo(url: string) {
  return /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url);
}

function variantLabel(index: number) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return alphabet[index] ?? String(index + 1);
}

export function ShotVariantLab({ data, shot }: { data: VideoWorkspaceData; shot: ExtendedMusicVideoShot }) {
  const [pending, startTransition] = useTransition();
  const variants = data.generations
    .filter((generation) => generation.shot_id === shot.id && ["test_video", "shot_video"].includes(generation.operation_type))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const processing = variants.some((variant) => ["approved", "submitted", "queued", "in_progress"].includes(variant.status));
  const canVariant = ["generated", "performance"].includes(shot.shot_type) && Boolean(shot.prompt && shot.selected_model);

  return (
    <section className="video-editor-variant-lab" aria-label="Shot A/B variants">
      <div className="video-editor-variant-head">
        <div><span>A/B variants</span><strong>{variants.length ? `${variants.length} takes` : "No takes yet"}</strong></div>
        <div>
          {processing ? <button type="button" className="text-button" disabled={pending} onClick={() => startTransition(() => refreshVideoShotVariants({ projectId: data.project.id, shotId: shot.id }))}>Refresh</button> : null}
          <button type="button" className="button" disabled={!canVariant || pending} onClick={() => startTransition(() => prepareVideoShotVariant({ projectId: data.project.id, shotId: shot.id }))}>New variant</button>
        </div>
      </div>
      <p>Preparing a take is free and gives you the exact reserved-credit quote. Spend happens only after you approve that specific take.</p>
      {variants.length ? <div className="video-editor-variant-grid">
        {variants.map((variant, index) => {
          const asset = assetForGeneration(data, variant);
          const meta = record(variant.provider_metadata);
          const rejected = meta.review === "rejected";
          const selected = Boolean(variant.result_asset_id && variant.result_asset_id === shot.selected_asset_id);
          const inFlight = ["approved", "submitted", "queued", "in_progress"].includes(variant.status);
          return (
            <article key={variant.id} className={`${selected ? "is-selected" : ""} ${rejected ? "is-rejected" : ""}`}>
              <div className="video-editor-variant-preview">
                {asset?.public_url ? (isVideo(asset.public_url) ? <video src={asset.public_url} muted playsInline preload="metadata" /> : <img src={asset.public_url} alt="" />) : <div><strong>{variantLabel(index)}</strong><span>{inFlight ? "Generating" : variant.status}</span></div>}
                <i>{variantLabel(index)}</i>
                {selected ? <b>WINNER</b> : null}
              </div>
              <div className="video-editor-variant-meta"><strong>{variant.model}</strong><small>v{variant.prompt_version} · {Number(variant.estimated_credits || 0).toFixed(1)} cr reserve</small></div>
              <div className="video-editor-variant-actions">
                {variant.status === "planned" && !variant.approval_id ? <button type="button" className="button primary" disabled={pending} onClick={() => startTransition(() => approveAndGenerateVideoVariant({ projectId: data.project.id, generationId: variant.id }))}>Generate · {Number(variant.estimated_credits || 0).toFixed(1)} cr</button> : null}
                {variant.status === "completed" && variant.result_asset_id && !selected ? <button type="button" className="button primary" disabled={pending} onClick={() => startTransition(() => selectVideoShotVariant({ projectId: data.project.id, generationId: variant.id }))}>Use take {variantLabel(index)}</button> : null}
                {variant.status === "completed" && variant.result_asset_id && !selected && !rejected ? <button type="button" className="text-button" disabled={pending} onClick={() => startTransition(() => rejectVideoShotVariant({ projectId: data.project.id, generationId: variant.id }))}>Reject</button> : null}
                {inFlight ? <span className="video-editor-variant-processing"><i />{variant.status.replaceAll("_", " ")}</span> : null}
                {variant.status === "failed" ? <span className="video-editor-variant-error">Generation failed</span> : null}
              </div>
            </article>
          );
        })}
      </div> : <div className="video-editor-empty-note">Create two or three takes here, then choose the winner without disturbing the currently locked edit.</div>}
    </section>
  );
}
