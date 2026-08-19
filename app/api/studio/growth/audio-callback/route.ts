import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { asGrowthClient } from "@/lib/studio/growth-db";
import type { Json } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const secret = process.env.MEDIA_WORKER_SECRET?.trim();
  const authorization = request.headers.get("authorization") || "";
  if (!secret || !authorization.startsWith("Bearer ")) return false;
  const actual = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
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

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = record(await request.json().catch(() => null));
  const trackId = typeof payload.job_id === "string" ? payload.job_id : "";
  const status = typeof payload.status === "string" ? payload.status : "";
  if (!trackId || !["running","completed","failed"].includes(status)) return NextResponse.json({ error: "Invalid callback" }, { status: 400 });

  const db = createServiceClient();
  const growth = asGrowthClient(db);
  const { data: track, error: lookupError } = await growth.from("track_vault").select("*").eq("id", trackId).maybeSingle();
  if (lookupError || !track) return NextResponse.json({ error: "Vault track not found" }, { status: 404 });

  if (status === "running") {
    const { error } = await growth.from("track_vault").update({ analysis: json({ status: "running", started_at: new Date().toISOString() }) }).eq("id", track.id);
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
  }

  if (status === "failed") {
    const message = typeof payload.error === "string" ? payload.error : "Audio analysis failed";
    const { error } = await growth.from("track_vault").update({ analysis: json({ status: "failed", message, completed_at: new Date().toISOString() }) }).eq("id", track.id);
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
  }

  const result = record(payload.result);
  const musicMap = record(result.music_map);
  if (!Object.keys(musicMap).length) return NextResponse.json({ error: "Worker returned no music map" }, { status: 422 });
  const sections = array(musicMap.sections).map(record);
  const hook = sections.find((section) => section.type === "hook") ?? sections.reduce<Record<string, unknown> | null>((best, section) => !best || number(section.energy) > number(best.energy) ? section : best, null);
  const hookEnergy = hook ? number(hook.energy, 0.5) : 0.5;
  const beatConfidence = number(musicMap.beat_confidence, 0);
  const durationMs = number(musicMap.duration_ms, (track.duration_seconds ?? 0) * 1000);
  const hookStartMs = hook ? number(hook.start_ms, 0) : 0;
  const hookEndMs = hook ? number(hook.end_ms, Math.min(durationMs, hookStartMs + 20_000)) : Math.min(durationMs, 20_000);
  const hookLength = Math.max(0, (hookEndMs - hookStartMs) / 1000);
  const shortLengthFit = hookLength >= 8 && hookLength <= 35 ? 1 : hookLength >= 5 && hookLength <= 50 ? 0.65 : 0.35;
  const peaks = array(musicMap.peaks_ms).length;
  const hookStrength = Math.round(clamp(52 + hookEnergy * 32 + beatConfidence * 16));
  const shortFormPotential = Math.round(clamp(45 + hookEnergy * 28 + beatConfidence * 10 + shortLengthFit * 12 + Math.min(peaks, 4) * 1.25));
  const durationSeconds = durationMs ? Math.round(durationMs / 1000) : track.duration_seconds;
  const durationFit = durationSeconds && durationSeconds >= 90 && durationSeconds <= 480 ? 1 : 0.65;
  const releaseReadiness = Math.round(clamp(Math.max(track.release_readiness, 62 + durationFit * 13 + beatConfidence * 7)));
  const confidence = Math.min(0.96, Math.max(0.55, 0.55 + beatConfidence * 0.2 + Math.min(sections.length, 8) / 8 * 0.18));
  const bpm = typeof musicMap.bpm === "number" ? musicMap.bpm : null;

  const { error } = await growth.from("track_vault").update({
    duration_seconds: durationSeconds,
    hook_start_seconds: Math.round(hookStartMs / 1000),
    hook_end_seconds: Math.round(hookEndMs / 1000),
    hook_strength: hookStrength,
    short_form_potential: shortFormPotential,
    release_readiness: releaseReadiness,
    analysis_confidence: confidence,
    audio_profile: json(musicMap),
    analysis: json({
      status: "completed",
      completed_at: new Date().toISOString(),
      source: "media_worker",
      bpm,
      beat_confidence: beatConfidence,
      detected_sections: sections.length,
      detected_peaks: peaks,
      inferred: {
        hook_strength: hookStrength,
        short_form_potential: shortFormPotential,
        release_readiness: releaseReadiness,
      },
    }),
  }).eq("id", track.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
