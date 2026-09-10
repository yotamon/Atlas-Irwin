import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { createServiceClient } from "@/lib/supabase/service";
import { loadVideoProjectContext } from "@/lib/video-director/context";
import { projectMediaLinkScopeFilter } from "@/lib/video-director/media-scope";
import type { VideoDatabase } from "@/types/video-database";

export async function loadVideoEditorSession(projectId: string) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const baseDb = createServiceClient();
  const db = baseDb as unknown as SupabaseClient<VideoDatabase>;
  const context = await loadVideoProjectContext(db, projectId, user.id, artist.artistId);
  if (context.project.status === "archived") throw new Error("Archived video projects are read only.");

  return {
    user,
    artist,
    context,
    baseDb,
    db,
    music: asArtistScopedMusicClient(baseDb),
  };
}

export type VideoEditorSession = Awaited<ReturnType<typeof loadVideoEditorSession>>;

export async function isAllowedProjectSourceAsset(input: {
  session: VideoEditorSession;
  assetId: string;
}) {
  const { user, artist, context, db, music } = input.session;
  const [linked, generated] = await Promise.all([
    music.from("media_links").select("media_asset_id")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .eq("media_asset_id", input.assetId)
      .or(projectMediaLinkScopeFilter(context.project.release_id, context.project.track_id))
      .limit(1).maybeSingle(),
    db.from("music_video_generations").select("result_asset_id")
      .eq("owner_id", user.id)
      .eq("project_id", context.project.id)
      .eq("result_asset_id", input.assetId)
      .limit(1).maybeSingle(),
  ]);
  if (linked.error) throw new Error(linked.error.message);
  if (generated.error) throw new Error(generated.error.message);
  return Boolean(linked.data || generated.data);
}

export async function assertAllowedArtistReferenceAssets(input: {
  session: VideoEditorSession;
  assetIds: string[];
}) {
  const results = await Promise.all(input.assetIds.map((assetId) => isAllowedProjectSourceAsset({
    session: input.session,
    assetId,
  })));
  if (results.some((allowed) => !allowed)) {
    throw new Error("Character references must belong to the active artist, release, track or video project.");
  }
}
