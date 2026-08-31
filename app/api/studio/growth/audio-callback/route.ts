import { createHash, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import {
  MEDIA_WORKER_CALLBACK_HASH_KEY,
  scheduleMediaWorkerSandboxCleanup,
} from "@/lib/media-worker/sandbox";
import { createServiceClient } from "@/lib/supabase/service";
import { asGrowthClient } from "@/lib/studio/growth-db";
import type { Json } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function safeEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function authorized(request: Request, analysis: Record<string, unknown>) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return false;
  const token = authorization.slice(7);
  if (!token) return false;
  const expectedHash = analysis[MEDIA_WORKER_CALLBACK_HASH_KEY];
  if (typeof expectedHash !== "string" || expectedHash.length !== 64) return false;
  const actualHash = createHash("sha256").update(token).digest("hex");
  return safeEqual(actualHash, expectedHash);
}

function withoutCallbackCredential(value: Record<string, unknown>) {
  const result = { ...value };
  delete result[MEDIA_WORKER_CALLBACK_HASH_KEY];
  return result;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}
function number(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}
function json(value: unknown) {
  return value as Json;
}
function scheduleCleanup() {
  after(scheduleMediaWorkerSandboxCleanup());
}

function topHook(musicMap: Record<string, unknown>) {
  const candidates = array(musicMap.hook_candidates)
    .map(record)
    .filter((candidate) => number(candidate.end_ms) > number(candidate.start_ms))
    .sort((a, b) => number(b.score) - number(a.score));
  const socialCuts = record(musicMap.social_cuts);
  const social15 = record(socialCuts["15"]);
  const selectedCandidate = candidates.find((candidate) => candidate.id === social15.candidate_id) ?? candidates[0] ?? null;
  if (Object.keys(social15).length) {
    return {
      startMs: number(social15.start_ms),
      endMs: number(social15.end_ms),
      score: number(social15.score, selectedCandidate ? number(selectedCandidate.score, 0.5) : 0.5),
      candidate: selectedCandidate,
      source: "social_15" as const,
    };
  }
  if (selectedCandidate) {
    return {
      startMs: number(selectedCandidate.start_ms),
      endMs: number(selectedCandidate.end_ms),
      score: number(selectedCandidate.score, 0.5),
      candidate: selectedCandidate,
      source: "ranked_candidate" as const,
    };
  }

  const sections = array(musicMap.sections).map(record);
  const legacy = sections.find((section) => section.type === "hook")
    ?? sections.reduce<Record<string, unknown> | null>(
      (best, section) => !best || number(section.energy) > number(best.energy) ? section : best,
      null,
    );
  return legacy ? {
    startMs: number(legacy.start_ms),
    endMs: number(legacy.end_ms),
    score: number(legacy.energy, 0.5),
    candidate: legacy,
    source: "legacy_section" as const,
  } : null;
}

export async function POST(request: Request) {
  const payload = record(await request.json().catch(() => null));
  const jobId = typeof payload.job_id === "string" ? payload.job_id : "";
  const separator = jobId.indexOf(":");
  const trackId = separator >= 0 ? jobId.slice(0, separator) : jobId;
  const requestId = separator >= 0 ? jobId.slice(separator + 1) : null;
  const status = typeof payload.status === "string" ? payload.status : "";
  if (!trackId || !["running", "completed", "failed"].includes(status)) {
    return NextResponse.json({ error: "Invalid callback" }, { status: 400 });
  }

  const db = createServiceClient();
  const growth = asGrowthClient(db);
  const { data: track, error: lookupError } = await growth.from("track_vault").select("*").eq("id", trackId).maybeSingle();
  if (lookupError || !track) return NextResponse.json({ error: "Vault track not found" }, { status: 404 });

  const currentAnalysis = record(track.analysis);
  const currentRequestId = typeof currentAnalysis.request_id === "string" ? currentAnalysis.request_id : null;
  if (currentRequestId && requestId !== currentRequestId) {
    return NextResponse.json({ ok: true, stale: true });
  }
  if (!authorized(request, currentAnalysis)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const callbackRequestId = requestId ?? currentRequestId;

  if (status === "running") {
    const { error } = await growth.from("track_vault").update({
      analysis: json({ ...currentAnalysis, status: "running", request_id: callbackRequestId, started_at: new Date().toISOString() }),
    }).eq("id", track.id);
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
  }

  if (status === "failed") {
    const message = typeof payload.error === "string" ? payload.error : "Audio analysis failed";
    const { error } = await growth.from("track_vault").update({
      analysis: json({
        ...withoutCallbackCredential(currentAnalysis),
        status: "failed",
        request_id: callbackRequestId,
        message,
        completed_at: new Date().toISOString(),
      }),
    }).eq("id", track.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    scheduleCleanup();
    return NextResponse.json({ ok: true });
  }

  const result = record(payload.result);
  const musicMap = record(result.music_map);
  if (!Object.keys(musicMap).length) return NextResponse.json({ error: "Worker returned no music map" }, { status: 422 });
  const sections = array(musicMap.sections).map(record);
  const hook = topHook(musicMap);
  const hookCandidate = hook?.candidate ? record(hook.candidate) : {};
  const hookMetrics = record(hookCandidate.metrics);
  const beatConfidence = number(musicMap.beat_confidence, 0);
  const durationMs = number(musicMap.duration_ms, (track.duration_seconds ?? 0) * 1000);
  const hookStartMs = hook ? hook.startMs : 0;
  const hookEndMs = hook ? hook.endMs : Math.min(durationMs, 20_000);
  const hookLength = Math.max(0, (hookEndMs - hookStartMs) / 1000);
  const shortLengthFit = hookLength >= 8 && hookLength <= 35 ? 1 : hookLength >= 5 && hookLength <= 50 ? 0.65 : 0.35;
  const peaks = array(musicMap.peaks_ms).length;
  const hookScore = hook?.score ?? 0.45;
  const loopability = number(hookMetrics.loopability, 0.45);
  const recurrence = number(hookMetrics.repetition, 0.45);
  const socialCuts = record(musicMap.social_cuts);
  const availableSocialCuts = Object.values(socialCuts).filter((cut) => Object.keys(record(cut)).length).length;
  const hookStrength = Math.round(clamp(38 + hookScore * 52 + beatConfidence * 5 + recurrence * 5));
  const shortFormPotential = Math.round(clamp(
    34 + hookScore * 34 + loopability * 13 + beatConfidence * 7 + shortLengthFit * 7 + Math.min(availableSocialCuts, 4) * 1.25,
  ));
  const durationSeconds = durationMs ? Math.round(durationMs / 1000) : track.duration_seconds;
  const durationFit = durationSeconds && durationSeconds >= 90 && durationSeconds <= 480 ? 1 : 0.65;
  const releaseReadiness = Math.round(clamp(Math.max(track.release_readiness, 62 + durationFit * 13 + beatConfidence * 7)));
  const semanticStructure = record(musicMap.analysis).semantic_structure === true;
  const confidence = Math.min(
    0.98,
    Math.max(0.55, 0.52 + beatConfidence * 0.18 + Math.min(sections.length, 8) / 8 * 0.14 + (semanticStructure ? 0.1 : 0)),
  );
  const bpm = typeof musicMap.bpm === "number" ? musicMap.bpm : null;

  const { error } = await growth.from("track_vault").update({
    duration_seconds: durationSeconds,
    hook_start_seconds: Math.floor(hookStartMs / 1000),
    hook_end_seconds: Math.ceil(hookEndMs / 1000),
    hook_strength: hookStrength,
    short_form_potential: shortFormPotential,
    release_readiness: releaseReadiness,
    analysis_confidence: confidence,
    audio_profile: json(musicMap),
    analysis: json({
      status: "completed",
      request_id: callbackRequestId,
      completed_at: new Date().toISOString(),
      source: "media_worker",
      runtime: "vercel_sandbox",
      music_intelligence_version: number(musicMap.version, 1),
      analysis_engine: record(musicMap.analysis).engine ?? null,
      semantic_structure: semanticStructure,
      bpm,
      beat_confidence: beatConfidence,
      detected_sections: sections.length,
      detected_peaks: peaks,
      hook_source: hook?.source ?? "none",
      hook_candidate_id: typeof hookCandidate.id === "string" ? hookCandidate.id : null,
      hook_score: hookScore,
      available_social_cuts: availableSocialCuts,
      inferred: {
        hook_strength: hookStrength,
        short_form_potential: shortFormPotential,
        release_readiness: releaseReadiness,
      },
    }),
  }).eq("id", track.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  scheduleCleanup();
  return NextResponse.json({ ok: true });
}
