import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json, MediaAsset } from "@/types/database";
import type { MusicVideoRender } from "@/types/database";
import type { MusicVideoWorkerJob, VideoDatabase } from "@/types/video-database";
import { reviewVideoDirectorRender, type VideoDirectorQualityReview } from "./quality";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function json(value: unknown) {
  return value as Json;
}

function reviewFrames(result: Record<string, unknown>) {
  const raw = result.review_frames;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const row = record(item);
    const url = typeof row.public_url === "string" && /^https:\/\//i.test(row.public_url) ? row.public_url : null;
    const timestampMs = typeof row.timestamp_ms === "number" ? Math.max(0, row.timestamp_ms) : null;
    return url && timestampMs !== null ? [{ url, timestampMs }] : [];
  });
}

export type RenderQualityOutcome = {
  passed: boolean;
  publishReady: boolean;
  unavailable: boolean;
  review: VideoDirectorQualityReview | Record<string, unknown>;
};

export async function reconcileVideoRenderQuality(input: {
  db: SupabaseClient<VideoDatabase>;
  job: MusicVideoWorkerJob;
  render: MusicVideoRender;
  asset: MediaAsset;
  result: Record<string, unknown>;
}): Promise<RenderQualityOutcome> {
  const frames = reviewFrames(input.result);
  let review: VideoDirectorQualityReview | Record<string, unknown>;
  let unavailable = false;
  try {
    review = await reviewVideoDirectorRender({
      ownerId: input.job.owner_id,
      projectId: input.job.project_id,
      renderId: input.render.id,
      frames,
    });
  } catch (error) {
    unavailable = true;
    review = {
      version: "video-director-quality-v1",
      passed: false,
      publishReady: false,
      verdict: "manual_review",
      summary: "Automated temporal QC was unavailable. Ensemblis did not auto-approve this master.",
      error: error instanceof Error ? error.message : "Final temporal QC failed.",
      humanReviewRequired: true,
      lipSyncAutomatedVerdict: "not_assessed_from_sparse_frames",
    };
  }

  const passed = !unavailable && review.passed === true;
  const publishReady = !unavailable && review.publishReady === true;
  const renderSpec = record(input.render.render_spec);
  const { error: renderError } = await input.db.from("music_video_renders").update({
    status: "completed",
    media_asset_id: input.asset.id,
    error: publishReady ? null : unavailable ? "Automated temporal QC unavailable" : passed ? "Human quality attestation required" : "Automated temporal QC failed",
    render_spec: json({
      ...renderSpec,
      worker_finishing: record(input.result.qc_summary),
      automated_qc: review,
      qc_frame_count: frames.length,
      qc_completed_at: new Date().toISOString(),
    }),
  }).eq("id", input.render.id).eq("owner_id", input.job.owner_id);
  if (renderError) throw new Error(renderError.message);

  if (input.render.render_type === "master_16_9") {
    const projectPatch = publishReady
      ? { status: "complete" as const, previous_status: null, last_error: null }
      : {
          status: "blocked" as const,
          previous_status: "rendering" as const,
          last_error: unavailable
            ? "Final master exists, but automated temporal QC was unavailable. Review is required before delivery."
            : passed
              ? "Final master passed automated visual QC but still requires the explicit human identity/lip-sync gate."
              : "Final master failed automated temporal/identity quality control. Review the QC result before delivery.",
        };
    const { error: projectError } = await input.db.from("music_video_projects").update(projectPatch)
      .eq("id", input.job.project_id).eq("owner_id", input.job.owner_id);
    if (projectError) throw new Error(projectError.message);
  } else if (!publishReady) {
    const { error: projectError } = await input.db.from("music_video_projects").update({
      last_error: unavailable
        ? "A derived video rendered, but automated temporal QC was unavailable."
        : passed
          ? "A derived video still requires human quality review."
          : "A derived video failed automated temporal QC.",
    }).eq("id", input.job.project_id).eq("owner_id", input.job.owner_id);
    if (projectError) throw new Error(projectError.message);
  }

  return { passed, publishReady, unavailable, review };
}
