import { notFound } from "next/navigation";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { createServiceClient } from "@/lib/supabase/service";
import {
  loadVideoWorkspaceSnapshot,
  VideoWorkspaceNotFoundError,
} from "@/lib/video-director/workspace";
import { VideoProjectWorkspace } from "@/components/studio/video-director/project-workspace";

export default async function VideoProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const { id } = await params;
  const { mode } = await searchParams;
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);

  try {
    const data = await loadVideoWorkspaceSnapshot({
      db: createServiceClient(),
      ownerId: user.id,
      artistId: artist.artistId,
      projectId: id,
    });

    return <VideoProjectWorkspace mode={mode === "pro" ? "pro" : "default"} data={data} />;
  } catch (error) {
    if (error instanceof VideoWorkspaceNotFoundError) notFound();
    throw error;
  }
}
