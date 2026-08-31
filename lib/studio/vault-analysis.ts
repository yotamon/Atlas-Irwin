import "server-only";

import { dispatchMediaWorkerJob, mediaWorkerReadiness } from "@/lib/media-worker/sandbox";
import { getSiteUrl } from "@/lib/site-url";

export function vaultAnalysisReadiness() {
  return { configured: mediaWorkerReadiness().configured };
}

export async function queueVaultAudioAnalysis(input: {
  trackId: string;
  audioUrl: string;
  callbackToken: string;
  requestId?: string;
}) {
  if (!vaultAnalysisReadiness().configured) {
    throw new Error("Media Worker is not available in this deployment.");
  }
  const callbackUrl = `${getSiteUrl()}/api/studio/growth/audio-callback`;
  const jobId = input.requestId ? `${input.trackId}:${input.requestId}` : input.trackId;
  return dispatchMediaWorkerJob({
    jobId,
    jobType: "analyze_audio",
    payload: { audio_url: input.audioUrl },
    callbackUrl,
    callbackToken: input.callbackToken,
  });
}
