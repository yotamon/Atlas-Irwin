import { notFound } from "next/navigation";
import { LivingArtworkWorkflow } from "@/components/studio/living-artwork-workflow";
import { requireArtistContext } from "@/lib/studio/artist-context";
import { loadLivingArtworkWorkspace } from "@/lib/marketing/living-artwork-workspace";

export default async function LivingArtworkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const artist = await requireArtistContext();

  let workspace;
  try {
    workspace = await loadLivingArtworkWorkspace({
      ownerId: artist.userId,
      artistId: artist.artistId,
      contentItemId: id,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("does not belong")) notFound();
    throw error;
  }

  return (
    <LivingArtworkWorkflow
      artistId={artist.artistId}
      workspace={workspace}
    />
  );
}
