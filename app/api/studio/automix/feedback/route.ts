import { NextResponse } from "next/server";
import { asAutoMixClient } from "@/lib/automix/jobs";
import { requireStudioAdmin } from "@/lib/auth/studio";
import {
  feedbackSignalFromPlan,
  plannerDjProfile,
  recordDjPreferenceEvidence,
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
  if (job.data.status !== "completed") {
    return NextResponse.json({
      error: "DJ-plan feedback is accepted only after the verified session has completed.",
    }, { status: 409 });
  }
  const plan = record(record(job.data.result_payload).plan);
  if (!Object.keys(plan).length) {
    return NextResponse.json({ error: "This session does not have a verified DJ plan yet." }, { status: 409 });
  }

  try {
    const signal = feedbackSignalFromPlan(plan);
    const { profile } = await recordDjPreferenceEvidence({
      client: supabase,
      ownerId: user.id,
      artistId: artist.artistId,
      jobId,
      evidenceType: "plan_feedback",
      evidenceKey: "whole_plan",
      verdict,
      signal,
      // A deliberate whole-plan judgement is strong evidence. Rejections remain inspectable but
      // are excluded from learned averages because they do not explain which dimension was wrong.
      weight: 0.9,
    });

    return NextResponse.json({
      saved: true,
      verdict,
      evidenceCount: profile.evidence_count,
      learnedConfidence: profile.learned_confidence,
      plannerProfile: plannerDjProfile(profile),
    });
  } catch {
    return NextResponse.json({ error: "Could not save or recalculate DJ-plan feedback." }, { status: 500 });
  }
}
