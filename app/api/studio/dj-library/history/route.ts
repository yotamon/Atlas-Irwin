import { NextResponse } from "next/server";
import { plannerDjProfile, recordDjLibraryHistoryEvidence } from "@/lib/automix/personalization";
import { preferenceSignalFromHistoryObservation } from "@/lib/dj-library/history-signal";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveArtistContext } from "@/lib/studio/artist-context";
import type { DjLibraryHistorySourceKind } from "@/types/dj-intelligence-database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_KINDS = new Set<DjLibraryHistorySourceKind>(["rekordbox", "serato", "traktor", "local_library"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function POST(request: Request) {
  const body = record(await request.json().catch(() => null));
  const artistId = typeof body.artistId === "string" ? body.artistId.trim() : "";
  const sourceKind = typeof body.sourceKind === "string" && SOURCE_KINDS.has(body.sourceKind as DjLibraryHistorySourceKind)
    ? body.sourceKind as DjLibraryHistorySourceKind
    : null;
  const sourceId = typeof body.sourceId === "string" ? body.sourceId.trim() : "";
  const sourceRevision = typeof body.sourceRevision === "string" ? body.sourceRevision.trim() : "";

  if (!UUID_RE.test(artistId) || !sourceKind || !sourceId || !sourceRevision) {
    return NextResponse.json({ error: "A valid artist and DJ-library source identity are required." }, { status: 400 });
  }
  if (sourceId.length > 160 || sourceRevision.length > 200) {
    return NextResponse.json({ error: "DJ-library source identity is too long." }, { status: 400 });
  }

  let observation;
  try {
    observation = preferenceSignalFromHistoryObservation(body.observation);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Invalid DJ-library history observation.",
    }, { status: 400 });
  }
  if (observation.observation.orderedPairCount < 1) {
    return NextResponse.json({ error: "At least one ordered play transition is required for learning." }, { status: 409 });
  }

  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveArtistContext(supabase, user, artistId);
  try {
    const { profile } = await recordDjLibraryHistoryEvidence({
      client: supabase,
      ownerId: user.id,
      artistId: artist.artistId,
      sourceKind,
      sourceId,
      sourceRevision,
      evidenceKey: "ordered-play-sequence-v1",
      signal: observation.signal,
      weight: observation.weight,
      sampleCount: observation.observation.sampleCount,
    });
    return NextResponse.json({
      saved: true,
      sourceKind,
      sampleCount: observation.observation.sampleCount,
      learnedConfidence: profile.learned_confidence,
      evidenceCount: profile.evidence_count,
      plannerProfile: plannerDjProfile(profile),
    });
  } catch {
    return NextResponse.json({ error: "Could not save DJ-library history intelligence." }, { status: 500 });
  }
}
