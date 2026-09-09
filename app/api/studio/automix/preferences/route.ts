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
    learned_preferences: existing.data?.learned_preferences ?? json({}),
    learned_confidence: existing.data?.learned_confidence ?? 0,
    evidence_count: existing.data?.evidence_count ?? 0,
    profile_version: 1,
  }, { onConflict: "owner_id,artist_id" }).select("*").single();
  if (saved.error) {
    return NextResponse.json({ error: "Could not save Personal DJ Intelligence." }, { status: 500 });
  }

  return NextResponse.json({
    saved: true,
    preferences: normalizeDjPreferences(saved.data.explicit_preferences),
    plannerProfile: plannerDjProfile(saved.data),
  });
}
