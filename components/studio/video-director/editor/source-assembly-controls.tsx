"use client";

/* eslint-disable @next/next/no-img-element */
import { useTransition } from "react";
import {
  applyAllVideoSourceSuggestions,
  applyVideoSourceSuggestion,
  planVideoSourceAssembly,
} from "@/app/studio/video-editor-actions";
import type { MediaAsset } from "@/types/database";
import type { ExtendedMusicVideoShot } from "@/types/video-database";
import type { VideoWorkspaceData } from "../workspace-types";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isVideoAsset(asset: MediaAsset | null) {
  if (!asset) return false;
  return asset.mime_type?.startsWith("video/") === true || /video|footage|clip/.test(asset.asset_type.toLowerCase());
}

function suggestionFor(shot: ExtendedMusicVideoShot | null) {
  const suggestion = record(record(shot?.editor_config).source_suggestion);
  const assetId = typeof suggestion.assetId === "string" ? suggestion.assetId : null;
  if (!assetId) return null;
  return {
    assetId,
    reason: typeof suggestion.reason === "string" ? suggestion.reason : "Best available source match",
    confidence: typeof suggestion.confidence === "number" ? suggestion.confidence : 0.5,
    sourceOffsetMs: typeof suggestion.sourceOffsetMs === "number" ? suggestion.sourceOffsetMs : 0,
  };
}

function confidenceLabel(value: number) {
  if (value >= 0.78) return "Strong match";
  if (value >= 0.58) return "Useful match";
  return "Tentative match";
}

export function SourceAssemblyControls({
  data,
  selectedShot,
}: {
  data: VideoWorkspaceData;
  selectedShot: ExtendedMusicVideoShot | null;
}) {
  const [pending, startTransition] = useTransition();
  const projectAssembly = record(record(data.project.editor_state).source_assembly);
  const suggestions = data.shots.flatMap((shot) => suggestionFor(shot) ? [shot] : []);
  const selectedSuggestion = suggestionFor(selectedShot);
  const selectedAsset = selectedSuggestion
    ? data.assets.find((asset) => asset.id === selectedSuggestion.assetId) ?? null
    : null;
  const generatedAvoided = typeof projectAssembly.generated_shots_avoided === "number" ? projectAssembly.generated_shots_avoided : 0;
  const unresolved = typeof projectAssembly.unresolved === "number" ? projectAssembly.unresolved : null;

  return (
    <section className="video-editor-auto-edit" aria-label="Source footage auto-edit">
      <div className="video-editor-auto-edit-head">
        <div>
          <span>Source Auto-Edit</span>
          <strong>{suggestions.length ? `${suggestions.length} source suggestions` : "Build a real-media rough cut"}</strong>
        </div>
        <button
          type="button"
          className="button"
          disabled={pending}
          onClick={() => startTransition(async () => {
            await planVideoSourceAssembly({ projectId: data.project.id });
          })}
        >{pending ? "Planning..." : suggestions.length ? "Refresh plan" : "Plan rough cut"}</button>
      </div>
      <p>Ensemblis ranks existing artist media from provenance, role, timing, aspect and editorial metadata. It does not pretend to understand footage it has not visually analyzed, and it never replaces a locked source automatically.</p>

      {suggestions.length ? <div className="video-editor-auto-edit-summary">
        <span><strong>{suggestions.length}</strong> proposed</span>
        {generatedAvoided > 0 ? <span><strong>{generatedAvoided}</strong> generations potentially avoided</span> : null}
        {unresolved !== null ? <span><strong>{unresolved}</strong> unresolved</span> : null}
      </div> : null}

      {selectedShot && selectedSuggestion ? (
        <article className="video-editor-source-suggestion">
          <div className="video-editor-source-suggestion-preview">
            {selectedAsset?.public_url ? (
              isVideoAsset(selectedAsset)
                ? <video src={selectedAsset.public_url} muted playsInline preload="metadata" />
                : <img src={selectedAsset.public_url} alt="Suggested source" />
            ) : <div>Source preview unavailable</div>}
          </div>
          <div className="video-editor-source-suggestion-copy">
            <span>{confidenceLabel(selectedSuggestion.confidence)}</span>
            <strong>Suggested for Shot {selectedShot.display_order + 1}</strong>
            <p>{selectedSuggestion.reason}</p>
            {selectedSuggestion.sourceOffsetMs > 0 ? <small>Suggested source-in: {(selectedSuggestion.sourceOffsetMs / 1000).toFixed(1)}s</small> : null}
          </div>
          <button
            type="button"
            className="button primary"
            disabled={pending}
            onClick={() => startTransition(() => applyVideoSourceSuggestion({ projectId: data.project.id, shotId: selectedShot.id }))}
          >Use this source</button>
        </article>
      ) : selectedShot && !selectedShot.selected_asset_id && suggestions.length ? (
        <div className="video-editor-empty-note">No confident existing-media match for this selected shot. Keep it generative or assign media manually.</div>
      ) : null}

      {suggestions.length > 1 ? <button
        type="button"
        className="text-button video-editor-auto-edit-apply-all"
        disabled={pending}
        onClick={() => startTransition(async () => {
          await applyAllVideoSourceSuggestions({ projectId: data.project.id });
        })}
      >Apply all suggestions to unresolved shots</button> : null}
    </section>
  );
}