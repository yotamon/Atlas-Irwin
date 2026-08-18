import { notFound } from "next/navigation";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { VideoProjectWorkspace } from "@/components/studio/video-director/project-workspace";

function hasStructuredValue(value: unknown) {
  if (!value) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

export default async function VideoProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase } = await requireStudioAdmin();

  const { data: project, error: projectError } = await supabase
    .from("music_video_projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (projectError) throw new Error(projectError.message);
  if (!project) notFound();

  const [
    { data: release, error: releaseError },
    { data: track, error: trackError },
    { count: conceptCount },
    { count: sceneCount },
    { count: shotCount },
    { data: mediaLinks, error: mediaLinksError },
  ] = await Promise.all([
    supabase.from("releases").select("*").eq("id", project.release_id).maybeSingle(),
    supabase.from("tracks").select("*").eq("id", project.track_id).maybeSingle(),
    supabase.from("music_video_concepts").select("id", { count: "exact", head: true }).eq("project_id", project.id),
    supabase.from("music_video_scenes").select("id", { count: "exact", head: true }).eq("project_id", project.id),
    supabase.from("music_video_shots").select("id", { count: "exact", head: true }).eq("project_id", project.id),
    supabase
      .from("media_links")
      .select("id,role,release_id,track_id")
      .or(`release_id.eq.${project.release_id},track_id.eq.${project.track_id}`),
  ]);

  if (releaseError) throw new Error(releaseError.message);
  if (trackError) throw new Error(trackError.message);
  if (mediaLinksError) throw new Error(mediaLinksError.message);
  if (!release || !track || track.release_id !== release.id) notFound();

  const roles = new Set((mediaLinks ?? []).map((link) => link.role));
  const hasAudio = Boolean(track.audio_url) || roles.has("master_audio") || roles.has("audio_preview");
  const hasArtwork = Boolean(release.artwork_url) || roles.has("cover") || roles.has("alternate_artwork");

  return (
    <VideoProjectWorkspace
      project={project}
      release={release}
      track={track}
      hasAudio={hasAudio}
      hasArtwork={hasArtwork}
      hasReleaseIdentity={hasStructuredValue(release.release_identity)}
      conceptCount={conceptCount ?? 0}
      sceneCount={sceneCount ?? 0}
      shotCount={shotCount ?? 0}
    />
  );
}
