import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveArtistContext, resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { deriveDistributionArtistState } from "@/lib/distribution/artist-facing";
import { buildDistributionHandoff } from "@/lib/distribution/handoff";
import { loadMasterReadinessByTrack } from "@/lib/mastering/distribution-readiness";
import type { DistributionDatabase } from "@/types/distribution-database";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid release identifier." }, { status: 400 });
  }

  const { supabase, user } = await requireStudioAdmin();
  const artistParam = new URL(request.url).searchParams.get("artist")?.trim() ?? "";
  const artist = artistParam
    ? await resolveArtistContext(supabase, user, artistParam)
    : await resolveDefaultArtistContext(supabase, user);
  const db = supabase as unknown as SupabaseClient<DistributionDatabase>;

  const [
    releaseResult, tracksResult, configResult, releaseMetaResult,
    metadataResult, writersResult, contributorsResult, profilesResult, issuesResult,
  ] = await Promise.all([
    db.from("releases").select("*").eq("id", id).eq("owner_id", user.id).eq("artist_id", artist.artistId).maybeSingle(),
    db.from("tracks").select("*").eq("release_id", id).eq("owner_id", user.id).eq("artist_id", artist.artistId).order("display_order"),
    db.from("release_distribution_configs").select("*").eq("release_id", id).eq("owner_id", user.id).eq("artist_id", artist.artistId).maybeSingle(),
    db.from("distribution_release_metadata").select("*").eq("release_id", id).eq("owner_id", user.id).eq("artist_id", artist.artistId).maybeSingle(),
    db.from("distribution_track_metadata").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId),
    db.from("distribution_track_writers").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId),
    db.from("distribution_track_contributors").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId),
    db.from("distribution_artist_profiles").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId),
    db.from("distribution_validation_issues").select("*").eq("release_id", id).eq("owner_id", user.id).eq("artist_id", artist.artistId).in("status", ["open", "acknowledged"]),
  ]);

  const failures = [
    releaseResult, tracksResult, configResult, releaseMetaResult,
    metadataResult, writersResult, contributorsResult, profilesResult, issuesResult,
  ].find((result) => result.error);
  if (failures?.error) {
    return NextResponse.json({ error: "Distribution handoff is temporarily unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  const release = releaseResult.data;
  if (!release) return NextResponse.json({ error: "Release not found." }, { status: 404 });

  const tracks = tracksResult.data ?? [];
  const trackIds = new Set(tracks.map((track) => track.id));
  const trackMetadata = (metadataResult.data ?? []).filter((row) => trackIds.has(row.track_id));
  const writers = (writersResult.data ?? []).filter((row) => trackIds.has(row.track_id));
  const contributors = (contributorsResult.data ?? []).filter((row) => trackIds.has(row.track_id));
  const artistProfiles = (profilesResult.data ?? []).filter((row) => row.artist_name === release.artist);
  const masterReadiness = await loadMasterReadinessByTrack(supabase, user.id, artist.artistId, tracks);
  const state = deriveDistributionArtistState({
    release,
    tracks,
    config: configResult.data,
    releaseMetadata: releaseMetaResult.data,
    trackMetadata,
    writers,
    contributors,
    artistProfiles,
    openIssues: issuesResult.data ?? [],
    masterReadinessByTrack: masterReadiness,
  });

  const packageData = buildDistributionHandoff({
    release,
    tracks,
    releaseMetadata: releaseMetaResult.data,
    trackMetadata,
    writers,
    contributors,
    rights: configResult.data?.rights ?? null,
    aiProvenance: configResult.data?.ai_provenance ?? null,
    masterGates: Object.fromEntries(tracks.map((track) => [track.id, masterReadiness[track.id]?.distributionGate ?? null])),
    decisions: state.decisions,
    exportedAt: new Date().toISOString(),
  });

  const safeTitle = release.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "release";
  return new Response(JSON.stringify(packageData, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeTitle}-distribution-handoff.json"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Vary": "Cookie",
    },
  });
}
