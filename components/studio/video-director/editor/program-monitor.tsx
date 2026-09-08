"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useRef } from "react";
import type { MediaAsset } from "@/types/database";
import type { ExtendedMusicVideoShot } from "@/types/video-database";
import type { VideoWorkspaceData } from "../workspace-types";
import { formatEditorTime } from "@/lib/video-director/editor";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isVideoAsset(asset: MediaAsset | null) {
  if (!asset) return false;
  const url = asset.public_url?.toLowerCase() ?? "";
  return asset.mime_type?.startsWith("video/") === true || /\.(mp4|mov|webm|m4v)(\?|$)/.test(url) || /video|footage|clip/.test(asset.asset_type.toLowerCase());
}

function assetForShot(data: VideoWorkspaceData, shot: ExtendedMusicVideoShot | null) {
  if (!shot) return null;
  const latestCompleted = [...data.generations]
    .reverse()
    .find((generation) => generation.shot_id === shot.id && generation.status === "completed" && generation.result_asset_id);
  const id = shot.selected_asset_id ?? latestCompleted?.result_asset_id ?? shot.start_asset_id ?? null;
  return id ? data.assets.find((asset) => asset.id === id) ?? null : null;
}

function sourceOffsetMs(shot: ExtendedMusicVideoShot | null) {
  if (!shot) return 0;
  const value = record(shot.editor_config).source_offset_ms;
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function ProgramMonitor({
  data,
  shot,
  playheadMs,
  isPlaying,
}: {
  data: VideoWorkspaceData;
  shot: ExtendedMusicVideoShot | null;
  playheadMs: number;
  isPlaying: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const asset = useMemo(() => assetForShot(data, shot), [data, shot]);
  const caption = shot ? record(shot.lyrics_config) : {};
  const captionEnabled = caption.enabled === true && typeof caption.text === "string" && caption.text.trim();
  const relativeMs = shot ? Math.max(0, playheadMs - shot.start_ms) : 0;
  const desiredSourceMs = sourceOffsetMs(shot) + relativeMs;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !asset?.public_url || !isVideoAsset(asset)) return;
    const sync = () => {
      const durationMs = Number.isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 : asset.duration_ms ?? 0;
      const targetMs = durationMs > 0 ? desiredSourceMs % durationMs : desiredSourceMs;
      const drift = Math.abs(video.currentTime * 1000 - targetMs);
      if (drift > (isPlaying ? 260 : 45)) video.currentTime = targetMs / 1000;
      if (isPlaying) {
        if (video.paused) void video.play().catch(() => undefined);
      } else if (!video.paused) {
        video.pause();
      }
    };
    if (video.readyState >= 1) sync();
    else video.addEventListener("loadedmetadata", sync, { once: true });
    return () => video.removeEventListener("loadedmetadata", sync);
  }, [asset, desiredSourceMs, isPlaying]);

  return (
    <div className="video-editor-preview-stage video-editor-program-monitor" aria-label="Program monitor">
      {asset?.public_url ? (
        isVideoAsset(asset) ? (
          <video ref={videoRef} key={asset.id} src={asset.public_url} muted playsInline preload="auto" />
        ) : (
          <img src={asset.public_url} alt="Active shot visual" />
        )
      ) : (
        <div className="video-editor-preview-empty">
          <span>{shot ? `Shot ${shot.display_order + 1}` : "Program monitor"}</span>
          <strong>{shot?.description ?? "Move the playhead onto a shot"}</strong>
          <p>{shot ? "Generate a take or attach real media to preview this timeline position." : "The monitor follows the master-audio playhead, not merely the selected Inspector shot."}</p>
        </div>
      )}
      {captionEnabled ? <div className={`video-editor-caption caption-${String(caption.style ?? "clean")}`}>{String(caption.text)}</div> : null}
      <div className="video-editor-preview-timecode">{formatEditorTime(playheadMs)}</div>
      {shot ? <div className="video-editor-preview-shot-label">Shot {shot.display_order + 1} · {shot.shot_type.replaceAll("_", " ")}</div> : null}
      {shot && sourceOffsetMs(shot) > 0 ? <div className="video-editor-source-in">Source in {formatEditorTime(sourceOffsetMs(shot))}</div> : null}
      {isPlaying ? <div className="video-editor-monitor-live" aria-label="Playing"><i />Program</div> : null}
    </div>
  );
}
