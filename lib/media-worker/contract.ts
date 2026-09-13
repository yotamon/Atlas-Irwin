import { z } from "zod";
import { MEDIA_WORKER_PROCESSOR_BY_JOB } from "@/lib/platform/processors";

export const MEDIA_WORKER_CONTRACT_VERSION = 1 as const;
export const MEDIA_WORKER_CONTRACT_PAYLOAD_KEY = "__ensemblis_media_worker_contract_version";

export const MEDIA_WORKER_JOB_TYPES = [
  "analyze_audio",
  "analyze_stem",
  "extract_frame",
  "render_master",
  "render_social",
  "render_promo",
  "render_hook",
  "render_audio_scene",
  "master_audio",
  "finish_social_video",
  "render_automix",
] as const;

export type MediaWorkerJobType = typeof MEDIA_WORKER_JOB_TYPES[number];

export const mediaWorkerJobTypeSchema = z.enum(MEDIA_WORKER_JOB_TYPES);
export const mediaWorkerCallbackSchema = z.object({
  job_id: z.string().min(1),
  status: z.enum(["running", "completed", "failed"]),
  result: z.record(z.string(), z.unknown()).default({}),
  error: z.string().nullable().optional(),
});

export type MediaWorkerCallback = z.infer<typeof mediaWorkerCallbackSchema>;

export function mediaWorkerProcessorId(jobType: MediaWorkerJobType) {
  return MEDIA_WORKER_PROCESSOR_BY_JOB[jobType];
}

export function withMediaWorkerContractVersion(payload: Record<string, unknown>) {
  return {
    ...payload,
    [MEDIA_WORKER_CONTRACT_PAYLOAD_KEY]: MEDIA_WORKER_CONTRACT_VERSION,
  };
}
