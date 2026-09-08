"use client";

import { useTransition } from "react";
import { approveVideoShotHumanQuality } from "@/app/studio/video-editor-quality-actions";
import type { ExtendedMusicVideoShot } from "@/types/video-database";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function ShotHumanQualityGate({ projectId, shot }: { projectId: string; shot: ExtendedMusicVideoShot }) {
  const [pending, startTransition] = useTransition();
  const performance = record(shot.performance_config);
  const quality = record(shot.quality_checks);
  const needsLipSync = shot.shot_type === "performance" && performance.lip_sync === true;
  const needsContinuity = Boolean(shot.character_id);
  if (!needsLipSync && !needsContinuity) return null;

  const exactAsset = Boolean(shot.selected_asset_id && quality.review_asset_id === shot.selected_asset_id);
  const syncApproved = !needsLipSync || quality.lip_sync_approved === true;
  const continuityApproved = !needsContinuity || quality.continuity_approved === true;
  const approved = exactAsset && syncApproved && continuityApproved;

  return (
    <section className={`video-editor-human-qc ${approved ? "is-approved" : "needs-review"}`}>
      <div>
        <span>Human QC gate</span>
        <strong>{approved ? "Approved for this exact take" : "Review the locked take before render"}</strong>
      </div>
      <ul>
        {needsContinuity ? <li className={exactAsset && continuityApproved ? "pass" : "pending"}>Identity and character continuity</li> : null}
        {needsLipSync ? <li className={exactAsset && syncApproved ? "pass" : "pending"}>Lip-sync against the original vocal</li> : null}
      </ul>
      <p>Temporal vision QC can catch drift and artifacts, but sparse frames cannot prove phoneme sync. Ensemblis therefore requires your explicit approval for lip-sync instead of inventing an automatic pass.</p>
      {!approved ? <button
        type="button"
        className="button primary"
        disabled={pending || shot.status !== "locked" || !shot.selected_asset_id}
        onClick={() => startTransition(() => approveVideoShotHumanQuality({ projectId, shotId: shot.id }))}
      >{pending ? "Saving review..." : "I reviewed this take · Approve sync & identity"}</button> : <small>Bound to asset {String(quality.review_asset_id).slice(0, 8)}…</small>}
    </section>
  );
}
