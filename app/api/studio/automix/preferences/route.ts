import { NextResponse } from "next/server";
import { requireStudioAdmin } from "@/lib/auth/studio";
import {
  asDjIntelligenceClient,
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const artistId = url.searchParams.get("artist")?.trim() || "";
  if (!UUID_RE.test(artistId)) {
    return NextResponse.json({ error: "A valid artist is required." }, { status: 400 });
  }

  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveArtistContext(supabase, user, artistId);
  const db = asDjIntelligenceClient(supabase);
  const result = await db.from("dj_profiles")
    .select("*")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .maybeSingle();
  if (result.error) {
    return NextResponse.json({ error: "Could not load Personal DJ Intelligence." }, { status: 500 });
  }

  return NextResponse.json({
    profileVersion: result.data?.profile_version ?? 2,
    preferences: normalizeDjPreferences(result.data?.explicit_preferences),
    learnedPreferences: normalizeDjPreferences(result.data?.learned_preferences),
    learnedConfidence: result.data?.learned_confidence ?? 0,
    evidenceCount: result.data?.evidence_count ?? 0,
    plannerProfile: plannerDjProfile(result.data),
  });
}

export async function PATCH(request: Request) {
  const body = record(await request.json().catch(() => null));
  const artistId = typeof body.artistId === "string" ? body.artistId.trim() : "";
  if (!UUID_RE.test(artistId)) {
    return NextResponse.json({ error: "A valid artist is required." }, { status: 400 });
  }
  const preferences = normalizeDjPreferences(body.preferences);

  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveArtistContext(supabase, user, artistId);
  const db = asDjIntelligenceClient(supabase);
  const existing = await db.from("dj_profiles")
    .select("*")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .maybeSingle();
  if (existing.error) {
    return NextResponse.json({ error: "Could not read Personal DJ Intelligence." }, { status: 500 });
  }

  const saved = await db.from("dj_profiles").upsert({
    owner_id: user.id,
    artist_id: artist.artistId,
    explicit_preferences: json(preferences),
    learned_preferences: existing.data?.learned_preferences ?? json(normalizeDjPreferences({})),
    learned_confidence: existing.data?.learned_confidence ?? 0,
    evidence_count: existing.data?.evidence_count ?? 0,
    profile_version: 2,
  }, { onConflict: "owner_id,artist_id" }).select("*").single();
  if (saved.error) {
    return NextResponse.json({ error: "Could not save Personal DJ Intelligence." }, { status: 500 });
  }

  return NextResponse.json({
    saved: true,
    profileVersion: saved.data.profile_version,
    preferences: normalizeDjPreferences(saved.data.explicit_preferences),
    learnedPreferences: normalizeDjPreferences(saved.data.learned_preferences),
    learnedConfidence: saved.data.learned_confidence,
    evidenceCount: saved.data.evidence_count,
    plannerProfile: plannerDjProfile(saved.data),
  });
}

export async function DELETE(request: Request) {
  const body = record(await request.json().catch(() => null));
  const artistId = typeof body.artistId === "string" ? body.artistId.trim() : "";
  if (!UUID_RE.test(artistId)) {
    return NextResponse.json({ error: "A valid artist is required." }, { status: 400 });
  }

  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveArtistContext(supabase, user, artistId);
  const db = asDjIntelligenceClient(supabase);

  const history = await db.from("dj_library_history_evidence")
    .delete()
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId);
  if (history.error) {
    return NextResponse.json({ error: "Could not reset imported DJ-library learning." }, { status: 500 });
  }

  const decisions = await db.from("dj_preference_evidence")
    .delete()
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId);
  if (decisions.error) {
    return NextResponse.json({ error: "Could not reset Set Builder learning evidence." }, { status: 500 });
  }

  const profile = await db.from("dj_profiles")
    .delete()
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId);
  if (profile.error) {
    return NextResponse.json({ error: "Could not reset Personal DJ Intelligence." }, { status: 500 });
  }

  const defaults = normalizeDjPreferences({});
  return NextResponse.json({
    reset: true,
    preferences: defaults,
    learnedPreferences: defaults,
    learnedConfidence: 0,
    evidenceCount: 0,
    plannerProfile: plannerDjProfile(null),
  });
}
