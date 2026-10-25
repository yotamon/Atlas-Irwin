import { notFound } from "next/navigation";
import { ReleaseVisualWorkflow } from "@/components/studio/release-visual-workflow";
import { requireArtistContext } from "@/lib/studio/artist-context";
import { loadReleaseVisualWorkspace } from "@/lib/marketing/release-visual-workspace";

export default async function ReleaseVisualPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const artist = await requireArtistContext();

  let workspace;
  try {
    workspace = await loadReleaseVisualWorkspace({
      ownerId: artist.userId,
      artistId: artist.artistId,
      contentItemId: id,
    });
  } catch (error) {
    if (error instanceof Error && /does not belong|not found/i.test(error.message)) notFound();
    throw error;
  }

  return <ReleaseVisualWorkflow artistId={artist.artistId} workspace={workspace} />;
}
