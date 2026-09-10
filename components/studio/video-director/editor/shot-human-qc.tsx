"use client";

import { useMemo, useState, useTransition } from "react";
import { approveVideoShotHumanQuality } from "@/app/studio/video-editor-quality-actions";
import type { ExtendedMusicVideoShot } from "@/types/video-database";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function ShotHumanQualityGate({ projectId, shot }: { projectId: string; shot: ExtendedMusicVideoShot }) {
  const [pending, startTransition] = useTransition();
  const [identityChecked, setIdentityChecked] = useState(false);
  const [syncChecked, setSyncChecked] = useState(false);
  const performance = record(shot.performance_config);
  const quality = record(shot.quality_checks);
  const needsIdentity = Boolean(shot.character_id);
  const needsSync = shot.shot_type === "performance" && performance.lip_sync === true;
  const selectedAssetId = shot.selected_asset_id;
  const reviewMatchesTake = Boolean(selectedAssetId && quality.review_asset_id === selectedAssetId);
  const identityApproved = !needsIdentity || (reviewMatchesTake && quality.continuity_approved === true);
  const syncApproved = !needsSync || (reviewMatchesTake && quality.lip_sync_approved === true);
  const approved = identityApproved && syncApproved;
  const canReview = shot.status === "locked" && Boolean(selectedAssetId);
  const canSubmit = canReview && (!needsIdentity || identityChecked) && (!needsSync || syncChecked);
  const requirements = useMemo(() => [
    needsIdentity ? { key: "identity", label: "Identity stays consistent with the approved character references", done: identityApproved } : null,
    needsSync ? { key: "sync", label: "Mouth performance feels correctly synchronized to the vocal", done: syncApproved } : null,
  ].filter((item): item is { key: string; label: string; done: boolean } => Boolean(item)), [identityApproved, needsIdentity, needsSync, syncApproved]);

  if (!requirements.length) return null;

  return (
    <section className={`video-editor-quality-gate ${approved ? "is-approved" : ""}`} aria-label="Human shot quality review">
      <div className="video-editor-quality-head">
        <div><span>Human quality gate</span><strong>{approved ? "Approved for this exact take" : canReview ? "Review the locked take" : "Lock a take before review"}</strong></div>
        <i>{approved ? "READY" : "REVIEW"}</i>
      </div>
      <p>Ensemblis will not claim phoneme-level lip-sync or identity continuity from sparse AI frame checks. These creative judgments stay explicitly yours.</p>
      <div className="video-editor-quality-checks">
        {requirements.map((requirement) => requirement.done ? (
          <div key={requirement.key}><i>✓</i><span>{requirement.label}</span></div>
        ) : (
          <label key={requirement.key}>
            <input
              type="checkbox"
              checked={requirement.key === "identity" ? identityChecked : syncChecked}
              disabled={!canReview || pending}
              onChange={(event) => requirement.key === "identity" ? setIdentityChecked(event.target.checked) : setSyncChecked(event.target.checked)}
            />
            <span>{requirement.label}</span>
          </label>
        ))}
      </div>
      {!approved ? <button
        type="button"
        className="button primary"
        disabled={!canSubmit || pending}
        onClick={() => startTransition(() => approveVideoShotHumanQuality({ projectId, shotId: shot.id }))}
      >{pending ? "Saving review..." : "Approve this take"}</button> : null}
      {reviewMatchesTake && approved ? <small>Changing the selected A/B take automatically invalidates this approval until the new take is reviewed.</small> : null}
    </section>
  );
}
