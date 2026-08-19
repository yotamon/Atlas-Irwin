import "server-only";

import { getSiteUrl } from "@/lib/site-url";

function workerUrl() {
  return process.env.MEDIA_WORKER_URL?.trim().replace(/\/$/, "") || null;
}

function workerSecret() {
  return process.env.MEDIA_WORKER_SECRET?.trim() || null;
}

export function vaultAnalysisReadiness() {
  return { configured: Boolean(workerUrl() && workerSecret()) };
}

export async function queueVaultAudioAnalysis(input: { trackId: string; audioUrl: string }) {
  const base = workerUrl();
  const secret = workerSecret();
  if (!base || !secret) throw new Error("Media Worker is not configured.");
  const callbackUrl = `${getSiteUrl()}/api/studio/growth/audio-callback`;
  const response = await fetch(`${base}/v1/jobs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      job_id: input.trackId,
      job_type: "analyze_audio",
      payload: { audio_url: input.audioUrl },
      callback_url: callbackUrl,
      callback_token: secret,
    }),
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof result.detail === "string" ? result.detail : `Media Worker dispatch failed (${response.status}).`);
  }
  return result;
}
