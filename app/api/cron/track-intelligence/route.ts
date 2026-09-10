import type { SupabaseClient } from "@supabase/supabase-js";
import { analyzeTrackLyrics } from "@/lib/lyrics-intelligence/analyze";
import { authorizeMarketingCron } from "@/lib/marketing/cron-auth";
import { regenerateSystemAudioScenes } from "@/lib/music-intelligence/stem-scenes";
import { createServiceClient } from "@/lib/supabase/service";
import type { LyricsDatabase } from "@/types/lyrics-database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function uuid(value: string | null) {
  const normalized = value?.trim() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null;
}

/**
 * Authenticated operational reconciliation for one canonical track.
 * This intentionally reuses the existing Lyrics Intelligence cache when possible:
 * semantic analysis is durable, while section/line timing and Audio Scenes are
 * regenerated against the latest master + Stem Intelligence evidence.
 */
export async function GET(request: Request) {
  const auth = await authorizeMarketingCron(request);
  if (!auth.authorized) {
    if (!auth.configured) {
      return Response.json({ error: "Cron authentication is not provisioned." }, { status: 503 });
    }
    return new Response("Unauthorized", { status: 401 });
  }

  const trackId = uuid(new URL(request.url).searchParams.get("track_id"));
  if (!trackId) return Response.json({ error: "A valid track_id is required." }, { status: 400 });

  const service = createServiceClient();
  const trackResult = await service.from("tracks")
    .select("id,owner_id,release_id,audio_url")
    .eq("id", trackId)
    .maybeSingle();
  if (trackResult.error) return Response.json({ error: trackResult.error.message }, { status: 500 });
  if (!trackResult.data) return Response.json({ error: "Track not found." }, { status: 404 });
  if (!trackResult.data.audio_url) return Response.json({ error: "Track has no canonical master." }, { status: 409 });

  try {
    const lyrics = await analyzeTrackLyrics({
      db: service as unknown as SupabaseClient<LyricsDatabase>,
      ownerId: trackResult.data.owner_id,
      trackId,
      releaseId: trackResult.data.release_id,
      cacheMode: "use",
    });
    const scenes = await regenerateSystemAudioScenes({
      client: service,
      ownerId: trackResult.data.owner_id,
      trackId,
    });

    return Response.json({
      ok: true,
      authSource: auth.source,
      trackId,
      lyrics: {
        alignedSections: lyrics.alignedSections,
        alignedLines: lyrics.alignedLines,
        lineAlignmentMethod: lyrics.lineAlignmentMethod,
        moments: lyrics.moments,
        semanticCacheHit: lyrics.cacheHit,
      },
      audioScenes: scenes.length,
    });
  } catch (error) {
    console.error("[track-intelligence-cron] reconciliation failed", error);
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Track Intelligence reconciliation failed.",
    }, { status: 500 });
  }
}
