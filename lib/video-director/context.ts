import "server-only";

import type { Json } from "@/types/database";
import type { LyricsDatabase } from "@/types/lyrics-database";
import type { AudioScene, StemDatabase } from "@/types/stem-database";
import type { ExtendedMusicVideoProject, VideoDatabase } from "@/types/video-database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadTrackLyricsContext } from "@/lib/lyrics-intelligence/context";
import { parseMusicMap, type DirectorPreferences, type MusicMap, type VideoProjectContext } from "./creative-director";

function stringArray(value: Json): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stemAwareMusicMap(value: Json, scenes: AudioScene[]) {
  const map = parseMusicMap(value);
  if (!map || !scenes.length) return map;
  return {
    ...map,
    stem_intelligence: {
      purpose: "Reusable stem-aware musical treatments. The full music video still follows the canonical master; use these scenes to inform musical causality, shot mechanics, edit motifs and derivative social concepts.",
      audio_scenes: scenes.slice(0, 10).map((scene) => ({
        id: scene.id,
        name: scene.name,
        type: scene.scene_type,
        description: scene.description,
        start_ms: scene.recommended_start_ms,
        end_ms: scene.recommended_end_ms,
        score: scene.score,
        objectives: scene.objective_tags,
        platform_hints: scene.platform_hints,
        is_pinned: scene.is_pinned,
        preview_ready: Boolean(scene.preview_asset_id),
        rationale: scene.rationale,
      })),
    },
  } as MusicMap;
}

export async function loadVideoProjectContext(
  db: SupabaseClient<VideoDatabase>,
  projectId: string,
  ownerId: string,
): Promise<VideoProjectContext & { project: ExtendedMusicVideoProject }> {
  const { data: project, error: projectError } = await db
    .from("music_video_projects")
    .select("*")
    .eq("id", projectId)
    .eq("owner_id", ownerId)
    .single();
  if (projectError || !project) throw new Error(projectError?.message || "Music video project not found.");

  const stemDb = db as unknown as SupabaseClient<StemDatabase>;
  const lyricsDb = db as unknown as SupabaseClient<LyricsDatabase>;
  const [releaseResult, trackResult, brandResult, linkResult, preferenceResult, sceneResult, lyrics] = await Promise.all([
    db.from("releases").select("*").eq("id", project.release_id).eq("owner_id", ownerId).single(),
    db.from("tracks").select("*").eq("id", project.track_id).eq("owner_id", ownerId).single(),
    db.from("brand_settings").select("content").eq("owner_id", ownerId).order("section"),
    db.from("media_links").select("media_asset_id,release_id,track_id,role")
      .eq("owner_id", ownerId)
      .or(`release_id.eq.${project.release_id},track_id.eq.${project.track_id}`),
    db.from("music_video_director_preferences").select("*").eq("owner_id", ownerId).maybeSingle(),
    stemDb.from("audio_scenes")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("track_id", project.track_id)
      .eq("status", "ready")
      .order("is_pinned", { ascending: false })
      .order("score", { ascending: false, nullsFirst: false }),
    loadTrackLyricsContext(lyricsDb, project.track_id, ownerId),
  ]);

  if (releaseResult.error || !releaseResult.data) throw new Error(releaseResult.error?.message || "Release not found.");
  if (trackResult.error || !trackResult.data) throw new Error(trackResult.error?.message || "Track not found.");
  if (brandResult.error) throw new Error(brandResult.error.message);
  if (linkResult.error) throw new Error(linkResult.error.message);
  if (preferenceResult.error) throw new Error(preferenceResult.error.message);
  if (sceneResult.error) throw new Error(sceneResult.error.message);

  const assetIds = [...new Set((linkResult.data ?? []).map((link) => link.media_asset_id))];
  const { data: media, error: mediaError } = assetIds.length
    ? await db.from("media_assets")
        .select("id,asset_type,mime_type,metadata,public_url")
        .eq("owner_id", ownerId)
        .in("id", assetIds)
    : { data: [], error: null };
  if (mediaError) throw new Error(mediaError.message);

  const preference = preferenceResult.data;
  const preferences: DirectorPreferences = {
    positive: preference ? stringArray(preference.positive_signals) : [],
    negative: preference ? stringArray(preference.negative_signals) : [],
  };

  return {
    project,
    release: releaseResult.data,
    track: trackResult.data,
    musicMap: stemAwareMusicMap(project.music_map, (sceneResult.data ?? []) as AudioScene[]),
    lyrics,
    brandSettings: (brandResult.data ?? []).map((item) => item.content),
    media: media ?? [],
    preferences,
  };
}

export async function resolveProjectAudioUrl(
  db: SupabaseClient<VideoDatabase>,
  project: ExtendedMusicVideoProject,
  ownerId: string,
) {
  const { data: track, error } = await db.from("tracks")
    .select("audio_url")
    .eq("id", project.track_id)
    .eq("owner_id", ownerId)
    .single();
  if (error) throw new Error(error.message);
  if (track?.audio_url) return track.audio_url;

  const { data: links, error: linkError } = await db.from("media_links")
    .select("media_asset_id,role,is_primary")
    .eq("owner_id", ownerId)
    .or(`release_id.eq.${project.release_id},track_id.eq.${project.track_id}`)
    .in("role", ["master_audio", "audio_preview"])
    .order("is_primary", { ascending: false });
  if (linkError) throw new Error(linkError.message);
  const ids = (links ?? []).map((link) => link.media_asset_id);
  if (!ids.length) return null;
  const { data: assets, error: assetError } = await db.from("media_assets")
    .select("id,public_url")
    .eq("owner_id", ownerId)
    .in("id", ids);
  if (assetError) throw new Error(assetError.message);
  const ordered = ids.map((id) => (assets ?? []).find((asset) => asset.id === id));
  return ordered.find((asset) => asset?.public_url)?.public_url ?? null;
}