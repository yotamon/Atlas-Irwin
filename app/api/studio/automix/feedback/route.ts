import { NextResponse } from "next/server";
import { asAutoMixClient } from "@/lib/automix/jobs";
import { requireStudioAdmin } from "@/lib/auth/studio";
import {
  asDjIntelligenceClient,
  feedbackSignalFromPlan,
  json,
  normalizeDjPreferences,
  plannerDjProfile,
} from "@/lib/automix/personalization";
import { resolveArtistContext } from "@/lib/studio/artist-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function averageSignals(values: unknown[]) {
  const signals = values.map(record);
  if (!signals.length) return {};
  const keys = [
    "harmonicAdventure",
    "transitionAggressiveness",
    "exploration",
  ] as const;
  return Object.fromEntries(keys.map((key) => {
    const samples = signals
      .map((signal) => signal[key])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const mean = samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0.5;
    return [key, clamp01(mean)];
  }));
}

export async function POST(request: Request) {
  const body = record(await request.json().catch(() => null));
  const artistId = typeof body.artistId === "string" ? body.artistId.trim() : "";
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const verdict = body.verdict === "accepted" || body.verdict === "rejected" ? body.verdict : null;
  if (!UUID_RE.test(artistId) || !UUID_RE.test(jobId) || !verdict) {
    return NextResponse.json({ error: "A valid artist, session and feedback verdict are required." }, { status: 400 });
  }

  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveArtistContext(supabase, user, artistId);
  const automix = asAutoMixClient(supabase);
  const job = await automix.from("automix_jobs")
    .select("id,status,result_payload")
    .eq("id", jobId)
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .maybeSingle();
  if (job.error) {
    return NextResponse.json({ error: "Could not load the AutoMix session." }, { status: 500 });
  }
  if (!job.data) return NextResponse.json({ error: "AutoMix session not found." }, { status: 404 });
  const plan = record(record(job.data.result_payload).plan);
  if (!Object.keys(plan).length) {
    return NextResponse.json({ error: "This session does not have a verified DJ plan yet." }, { status: 409 });
  }

  const signal = feedbackSignalFromPlan(plan);
  const db = asDjIntelligenceClient(supabase);
  const evidence = await db.from("dj_preference_evidence").upsert({
    owner_id: user.id,
    artist_id: artist.artistId,
    automix_job_id: jobId,
    evidence_type: "plan_feedback",
    verdict,
    signal: json(signal),
  }, { onConflict: "owner_id,artist_id,automix_job_id,evidence_type" }).select("*").single();
  if (evidence.error) {
    return NextResponse.json({ error: "Could not save DJ-plan feedback." }, { status: 500 });
  }

  const allEvidence = await db.from("dj_preference_evidence")
    .select("verdict,signal")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (allEvidence.error) {
    return NextResponse.json({ error: "Feedback was saved, but the DJ profile could not be recalculated." }, { status: 500 });
  }

  const accepted = (allEvidence.data ?? []).filter((item) => item.verdict === "accepted");
  const learned = averageSignals(accepted.map((item) => item.signal));
  const learnedConfidence = Math.min(0.6, accepted.length * 0.08);
  const current = await db.from("dj_profiles")
    .select("*")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .maybeSingle();
  if (current.error) {
    return NextResponse.json({ error: "Feedback was saved, but the DJ profile could not be loaded." }, { status: 500 });
  }

  const profile = await db.from("dj_profiles").upsert({
    owner_id: user.id,
    artist_id: artist.artistId,
    explicit_preferences: current.data?.explicit_preferences ?? json(normalizeDjPreferences({})),
    learned_preferences: json(learned),
    learned_confidence: learnedConfidence,
    evidence_count: allEvidence.data?.length ?? 0,
    profile_version: 1,
  }, { onConflict: "owner_id,artist_id" }).select("*").single();
  if (profile.error) {
    return NextResponse.json({ error: "Feedback was saved, but the DJ profile could not be updated." }, { status: 500 });
  }

  return NextResponse.json({
    saved: true,
    verdict,
    evidenceCount: profile.data.evidence_count,
    learnedConfidence: profile.data.learned_confidence,
    plannerProfile: plannerDjProfile(profile.data),
  });
}
